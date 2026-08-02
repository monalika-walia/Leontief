import { describe, expect, it } from "vitest";
import {
  checkPolicy,
  type Grant,
  HF_FLOOR,
  type PolicyContext,
  type ProposedAction,
  repayToRestore,
  SCALE,
} from "./policy.js";
import {
  DEFAULT_STRATEGY_CONFIG,
  hfGuard,
  idleSweep,
  propose,
  type UserState,
} from "./strategies.js";

const VAULT = "CB64EHOFGTWH2USSZP3PL2B66XJ4KD6A6C3SFXKPNTEO3NCIZFZWLHUS";
const POOL = "CCX7Z6TGAVAKOYMS3QAHD4VZHQB2QCC2XVQ4UWBZFSOX4HHDBB45EQ54";
const OTHER = "CDE5ZRPD2SJCUZIKEVM546Y25YIER35WYKVWICQFDW3I2ZHL2MLD4AOW";
const NOW = 1_800_000_000;

const grant = (over: Partial<Grant> = {}): Grant => ({
  user: "GCCDH7TXDEXCQZOCP7WTNV2MHSQOUSU736J6IRGZ5MPLJCNISGNMVYZD",
  allowedContracts: [VAULT, POOL],
  perActionCap: 100n * 10_000_000n,
  dailyCap: 250n * 10_000_000n,
  expiresAt: NOW + 86_400,
  revoked: false,
  strategy: "hf-guard",
  ...over,
});

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  grant: grant(),
  spentToday: 0n,
  postHf: SCALE * 2n,
  now: NOW,
  secondsSinceLastAction: null,
  cooldownSeconds: 300,
  killSwitch: false,
  ...over,
});

const action: ProposedAction = { kind: "repay", amount: 50n * 10_000_000n, contractId: POOL };

describe("checkPolicy", () => {
  it("allows an in-policy action", () => {
    expect(checkPolicy(action, ctx())).toEqual({ allow: true });
  });

  it("refuses when the kill switch is engaged", () => {
    const v = checkPolicy(action, ctx({ killSwitch: true }));
    expect(v).toMatchObject({ allow: false });
  });

  it("refuses a revoked or expired grant", () => {
    expect(checkPolicy(action, ctx({ grant: grant({ revoked: true }) })).allow).toBe(false);
    expect(checkPolicy(action, ctx({ grant: grant({ expiresAt: NOW }) })).allow).toBe(false);
    expect(checkPolicy(action, ctx({ grant: grant({ expiresAt: NOW - 1 }) })).allow).toBe(false);
  });

  it("refuses any contract outside the grant", () => {
    const v = checkPolicy({ ...action, contractId: OTHER }, ctx());
    expect(v).toMatchObject({ allow: false });
    if (!v.allow) expect(v.reason).toContain("not in this grant");
  });

  it("refuses digest-only users outright", () => {
    const v = checkPolicy(action, ctx({ grant: grant({ strategy: "digest-only" }) }));
    expect(v).toMatchObject({ allow: false });
  });

  it("enforces the per-action cap", () => {
    expect(checkPolicy({ ...action, amount: 100n * 10_000_000n }, ctx()).allow).toBe(true);
    expect(checkPolicy({ ...action, amount: 100n * 10_000_000n + 1n }, ctx()).allow).toBe(false);
  });

  it("enforces the daily cap — repetition cannot drain past it", () => {
    // The documented failure mode: a per-action cap alone is drained by repeats.
    let spent = 0n;
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      const a = { ...action, amount: 100n * 10_000_000n };
      if (checkPolicy(a, ctx({ spentToday: spent })).allow) {
        allowed++;
        spent += a.amount;
      }
    }
    expect(allowed).toBe(2); // 2 × 100 fits in 250; the third is refused
    expect(spent).toBeLessThanOrEqual(grant().dailyCap);
  });

  it("enforces the cooldown", () => {
    expect(checkPolicy(action, ctx({ secondsSinceLastAction: 299 })).allow).toBe(false);
    expect(checkPolicy(action, ctx({ secondsSinceLastAction: 300 })).allow).toBe(true);
  });

  it("enforces the 1.6 health-factor floor, and treats debt-free as fine", () => {
    expect(checkPolicy(action, ctx({ postHf: HF_FLOOR })).allow).toBe(true);
    expect(checkPolicy(action, ctx({ postHf: HF_FLOOR - 1n })).allow).toBe(false);
    expect(checkPolicy(action, ctx({ postHf: null })).allow).toBe(true);
  });

  it("has no override for the floor — every failing band is refused", () => {
    for (const hf of [0n, SCALE, SCALE + 1n, (SCALE * 15n) / 10n, HF_FLOOR - 1n]) {
      expect(checkPolicy(action, ctx({ postHf: hf })).allow).toBe(false);
    }
  });

  it("refuses non-positive amounts", () => {
    expect(checkPolicy({ ...action, amount: 0n }, ctx()).allow).toBe(false);
    expect(checkPolicy({ ...action, amount: -1n }, ctx()).allow).toBe(false);
  });
});

describe("repayToRestore", () => {
  it("returns the debt reduction that reaches the target", () => {
    const coll = 1_000n * 10_000_000n;
    const price = SCALE; // 1.0
    const debt = 500n * 10_000_000n; // hf = 1000*0.85/500 = 1.7
    const target = SCALE * 2n;
    const repay = repayToRestore(coll, debt, price, target);
    const after = debt - repay;
    const hfAfter = (((((coll * price) / SCALE) * 8_500n) / 10_000n) * SCALE) / after;
    expect(hfAfter).toBeGreaterThanOrEqual(target);
  });

  it("is zero when already at or above target", () => {
    const coll = 1_000n * 10_000_000n;
    expect(repayToRestore(coll, 100n * 10_000_000n, SCALE, SCALE * 2n)).toBe(0n);
    expect(repayToRestore(coll, 0n, SCALE, SCALE * 2n)).toBe(0n);
  });

  it("never proposes repaying more than the debt", () => {
    const coll = 1n;
    const debt = 1_000n * 10_000_000n;
    expect(repayToRestore(coll, debt, SCALE, SCALE * 2n)).toBeLessThanOrEqual(debt);
  });
});

describe("strategies", () => {
  const cfg = { vault: VAULT, miniPool: POOL, ...DEFAULT_STRATEGY_CONFIG };
  const state = (over: Partial<UserState> = {}): UserState => ({
    idleDebtAsset: 500n * 10_000_000n,
    idleUnderlying: 0n,
    collateralShares: 1_000n * 10_000_000n,
    debt: 500n * 10_000_000n,
    sharePrice: SCALE,
    hf: (SCALE * 17n) / 10n,
    ...over,
  });

  it("idle-sweep only fires above the threshold, and targets the vault", () => {
    expect(idleSweep(state({ idleUnderlying: 5n * 10_000_000n }), cfg)).toBeNull();
    const a = idleSweep(state({ idleUnderlying: 50n * 10_000_000n }), cfg);
    expect(a).toMatchObject({ kind: "wrap", contractId: VAULT });
  });

  it("hf-guard does nothing to a healthy or debt-free position", () => {
    expect(hfGuard(state({ hf: SCALE * 3n }), cfg)).toBeNull();
    expect(hfGuard(state({ debt: 0n, hf: null }), cfg)).toBeNull();
  });

  it("hf-guard repays when the HF slips, never more than idle cash", () => {
    const a = hfGuard(state({ hf: (SCALE * 12n) / 10n, idleDebtAsset: 10n * 10_000_000n }), cfg);
    expect(a).toMatchObject({ kind: "repay", contractId: POOL });
    expect(a?.amount).toBe(10n * 10_000_000n); // clamped to what the user holds
  });

  it("hf-guard does nothing when there is no idle cash to repay with", () => {
    expect(hfGuard(state({ hf: SCALE, idleDebtAsset: 0n }), cfg)).toBeNull();
  });

  it("digest-only never proposes anything, whatever the state", () => {
    for (const s of [state(), state({ hf: SCALE / 2n }), state({ idleUnderlying: 10n ** 12n })]) {
      expect(propose("digest-only", s, cfg)).toBeNull();
    }
  });

  it("a guard repayment always clears the policy floor when affordable", () => {
    const s = state({ hf: (SCALE * 12n) / 10n, idleDebtAsset: 1_000n * 10_000_000n });
    const a = hfGuard(s, cfg);
    expect(a).not.toBeNull();
    const after = s.debt - (a as ProposedAction).amount;
    const hfAfter =
      after === 0n
        ? null
        : (((((s.collateralShares * s.sharePrice) / SCALE) * 8_500n) / 10_000n) * SCALE) / after;
    if (hfAfter !== null) expect(hfAfter).toBeGreaterThanOrEqual(HF_FLOOR);
  });
});
