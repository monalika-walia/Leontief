// Engine behaviour against a real Postgres with a stubbed chain. Opt-in behind
// LEONTIEF_DB=1 (CI has no database), same convention as the indexer.
//
// These assert the properties that make Autopilot safe to switch on at all:
// it refuses when it cannot simulate, it refuses out-of-policy proposals, it
// records every refusal, and it loses capability the moment a grant is revoked.
import type { LeontiefClient, Signer } from "@leontief/sdk";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { migrate, sql } from "./db.js";
import { runCycle } from "./engine.js";
import { SCALE } from "./policy.js";

const live = process.env.LEONTIEF_DB === "1";
const USER = "GDIYIRHZBMTTEHDJAZ6P5N5A2SJAKF4TMUWTWJDC6QLYIUAA4KYGG2PN";
const VAULT = "CB64EHOFGTWH2USSZP3PL2B66XJ4KD6A6C3SFXKPNTEO3NCIZFZWLHUS";
const POOL = "CCX7Z6TGAVAKOYMS3QAHD4VZHQB2QCC2XVQ4UWBZFSOX4HHDBB45EQ54";

const config = {
  enabled: true,
  killed: false,
  VAULT,
  MINI_POOL: POOL,
  COOLDOWN_SECS: 0,
  MAX_ACTIONS_PER_CYCLE: 5,
  EXPLORER_BASE: "https://stellar.expert/explorer/testnet",
  APP_BASE_URL: "https://app.leontief.tech",
} as unknown as Config;

/** An at-risk position: 1000 shares at 1.0, 500 debt → HF 1.7 … then worse. */
function stubClient(over: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const client = {
    debtBalance: async () => 1_000n * 10_000_000n,
    underlyingBalance: async () => 0n,
    positions: async () => ({
      collateral_shares: 1_000n * 10_000_000n,
      debt: 500n * 10_000_000n,
    }),
    sharePrice: async () => SCALE,
    healthFactor: async () => (SCALE * 12n) / 10n, // 1.2 — below the guard trigger
    previewHealthFactor: async () => SCALE * 2n, // healthy after the repay
    repay: async () => {
      calls.push("repay");
      return { hash: "TXHASH_REPAY", returnValue: undefined };
    },
    supplyCollateral: async () => {
      calls.push("supply");
      return { hash: "TX", returnValue: undefined };
    },
    wrap: async () => {
      calls.push("wrap");
      return { hash: "TX", returnValue: undefined };
    },
    ...over,
  } as unknown as LeontiefClient;
  return { client, calls };
}

const signer: Signer = { address: USER, sign: async (x) => x };

async function seedGrant(over: Record<string, unknown> = {}) {
  await sql`DELETE FROM autopilot_log WHERE address = ${USER}`;
  await sql`DELETE FROM autopilot_grants WHERE address = ${USER}`;
  const g = {
    strategy: "hf-guard",
    allowed: [VAULT, POOL],
    perAction: (100n * 10_000_000n).toString(),
    daily: (250n * 10_000_000n).toString(),
    revoked: false,
    expires: "now() + interval '7 days'",
    ...over,
  } as { strategy: string; allowed: string[]; perAction: string; daily: string; revoked: boolean };
  await sql`
    INSERT INTO autopilot_grants
      (address, strategy, allowed_contracts, per_action_cap, daily_cap, revoked, expires_at, chat_id)
    VALUES (${USER}, ${g.strategy}, ${g.allowed}, ${g.perAction}, ${g.daily}, ${g.revoked},
            now() + interval '7 days', NULL)`;
}

const logRows = () =>
  sql<{ outcome: string; detail: string | null; action: string; tx: string | null }[]>`
    SELECT outcome, detail, action, tx FROM autopilot_log WHERE address = ${USER} ORDER BY id`;

describe.skipIf(!live)("autopilot engine (live Postgres, stubbed chain)", () => {
  beforeEach(async () => {
    await migrate();
  });
  afterAll(async () => {
    await sql`DELETE FROM autopilot_log WHERE address = ${USER}`;
    await sql`DELETE FROM autopilot_grants WHERE address = ${USER}`;
    await sql.end();
  });

  it("executes an in-policy hf-guard repay and logs it with both health factors", async () => {
    await seedGrant();
    const { client, calls } = stubClient();
    const notes: string[] = [];
    const n = await runCycle(
      client,
      config,
      () => signer,
      async (_c, t) => void notes.push(t),
    );

    expect(n).toBe(1);
    expect(calls).toEqual(["repay"]);
    const [row] = await logRows();
    expect(row).toMatchObject({ outcome: "executed", action: "repay", tx: "TXHASH_REPAY" });
    expect(notes[0]).toContain("health factor");
  });

  it("does nothing for digest-only users", async () => {
    await seedGrant({ strategy: "digest-only" });
    const { client, calls } = stubClient();
    const n = await runCycle(
      client,
      config,
      () => signer,
      async () => {},
    );
    expect(n).toBe(0);
    expect(calls).toEqual([]);
    expect(await logRows()).toHaveLength(0);
  });

  it("refuses — and records — when the pre-flight simulation fails", async () => {
    await seedGrant();
    const { client, calls } = stubClient({
      previewHealthFactor: async () => {
        throw new Error("oracle halted");
      },
    });
    const n = await runCycle(
      client,
      config,
      () => signer,
      async () => {},
    );

    expect(n).toBe(0);
    expect(calls).toEqual([]);
    const [row] = await logRows();
    expect(row.outcome).toBe("refused");
    expect(row.detail).toContain("refusing to act blind");
  });

  it("refuses when the action would land below the 1.6 floor", async () => {
    await seedGrant();
    const { client, calls } = stubClient({
      previewHealthFactor: async () => (SCALE * 15n) / 10n, // 1.5 < 1.6
    });
    const n = await runCycle(
      client,
      config,
      () => signer,
      async () => {},
    );

    expect(n).toBe(0);
    expect(calls).toEqual([]);
    const [row] = await logRows();
    expect(row.outcome).toBe("refused");
    expect(row.detail).toContain("below the 1.6 floor");
  });

  it("refuses a proposal above the per-action cap", async () => {
    await seedGrant({ perAction: (1n * 10_000_000n).toString() }); // cap 1 unit
    const { client, calls } = stubClient();
    const n = await runCycle(
      client,
      config,
      () => signer,
      async () => {},
    );
    expect(n).toBe(0);
    expect(calls).toEqual([]);
    expect((await logRows())[0].detail).toContain("per-action cap");
  });

  it("stops entirely when the kill switch is engaged", async () => {
    await seedGrant();
    const { client, calls } = stubClient();
    const n = await runCycle(
      client,
      { ...config, killed: true },
      () => signer,
      async () => {},
    );
    expect(n).toBe(0);
    expect(calls).toEqual([]);
  });

  it("takes no action when the grant is revoked — the row is not even active", async () => {
    await seedGrant();
    await sql`UPDATE autopilot_grants SET revoked = true WHERE address = ${USER}`;
    const { client, calls } = stubClient();
    const n = await runCycle(
      client,
      config,
      () => signer,
      async () => {},
    );
    expect(n).toBe(0);
    expect(calls).toEqual([]);
  });

  it("loses capability when the signer is gone, even if a grant lingers", async () => {
    await seedGrant();
    const { client, calls } = stubClient();
    // signerFor returns null — what revocation looks like to the engine.
    const n = await runCycle(
      client,
      config,
      () => null,
      async () => {},
    );
    expect(n).toBe(0);
    expect(calls).toEqual([]);
  });

  it("records a failure when the chain rejects the signature (revoked on-chain)", async () => {
    await seedGrant();
    const { client } = stubClient({
      repay: async () => {
        throw new Error("tx_bad_auth: signature no longer valid for this account");
      },
    });
    const n = await runCycle(
      client,
      config,
      () => signer,
      async () => {},
    );
    expect(n).toBe(0);
    const [row] = await logRows();
    expect(row.outcome).toBe("failed");
    expect(row.detail).toContain("tx_bad_auth");
  });
});
