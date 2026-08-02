// The leash.
//
// DECISIONS #7: Autopilot ships on Path B, where the on-chain grant is a classic
// additional signer that is NOT scope-limited. The single on-chain guarantee is
// that the user can revoke it instantly. Everything else — which contracts may be
// touched, how much per action, how much per day, and the health-factor floor —
// is enforced HERE. That makes this file the trust boundary, so it is pure,
// exhaustively tested, and fails closed on anything it cannot evaluate.
export const SCALE = 1_000_000_000_000n;

/** Spec-mandated floor. There is no override flag, and adding one would be a
 *  security review failure rather than a feature. */
export const HF_FLOOR = (SCALE * 16n) / 10n; // 1.6

export type ActionKind = "wrap" | "supply" | "repay";

export type ProposedAction = {
  kind: ActionKind;
  /** Notional in 7-dec units of the asset moved. */
  amount: bigint;
  /** Contract the action would invoke. */
  contractId: string;
};

export type Grant = {
  user: string;
  /** Contracts this grant may ever touch — the user's vault and the mini-pool. */
  allowedContracts: string[];
  perActionCap: bigint;
  dailyCap: bigint;
  /** Unix seconds. Path B cannot express this on-chain, so the engine owns it. */
  expiresAt: number;
  revoked: boolean;
  strategy: "idle-sweep" | "hf-guard" | "digest-only";
};

export type PolicyContext = {
  grant: Grant;
  /** Notional already spent by this user today, same units as the caps. */
  spentToday: bigint;
  /** Health factor AFTER the action, from pre-flight simulation. null = debt-free. */
  postHf: bigint | null;
  /** Unix seconds. */
  now: number;
  /** Seconds since this user's last autopilot action; null when there is none. */
  secondsSinceLastAction: number | null;
  cooldownSeconds: number;
  killSwitch: boolean;
};

export type Verdict = { allow: true } | { allow: false; reason: string };

const deny = (reason: string): Verdict => ({ allow: false, reason });

/**
 * Every check that stands between a strategy's suggestion and a signed
 * transaction. Order matters only for the error message; all of them must pass.
 */
export function checkPolicy(action: ProposedAction, ctx: PolicyContext): Verdict {
  if (ctx.killSwitch) return deny("global kill switch is engaged");
  if (ctx.grant.revoked) return deny("grant revoked");
  if (ctx.grant.expiresAt <= ctx.now) return deny("grant expired");
  if (ctx.grant.strategy === "digest-only")
    return deny("strategy is digest-only (reports, never acts)");

  if (action.amount <= 0n) return deny("non-positive amount");
  if (!ctx.grant.allowedContracts.includes(action.contractId)) {
    return deny(`contract ${action.contractId} is not in this grant`);
  }
  if (action.amount > ctx.grant.perActionCap) {
    return deny(`amount exceeds the per-action cap (${ctx.grant.perActionCap})`);
  }
  // A per-action cap alone is trivially drained by repetition — the daily cap is
  // what actually bounds a bad day (INTEGRATIONS/delegated-auth.md).
  if (ctx.spentToday + action.amount > ctx.grant.dailyCap) {
    return deny(
      `amount would exceed today's remaining budget (${ctx.grant.dailyCap - ctx.spentToday})`,
    );
  }
  if (ctx.secondsSinceLastAction !== null && ctx.secondsSinceLastAction < ctx.cooldownSeconds) {
    return deny(`cooldown: ${ctx.cooldownSeconds - ctx.secondsSinceLastAction}s remaining`);
  }

  // The floor. A debt-free position (null) is trivially above it; anything we
  // could not simulate is refused rather than guessed at.
  if (ctx.postHf !== null && ctx.postHf < HF_FLOOR) {
    return deny(`post-action health factor ${ctx.postHf} is below the 1.6 floor`);
  }
  return { allow: true };
}

/** Debt to repay so the position lands at or above `targetHf`. Ceils — repaying
 *  a stroop too much is safe, a stroop too little misses the target. */
export function repayToRestore(
  collateralShares: bigint,
  debt: bigint,
  sharePrice: bigint,
  targetHf: bigint,
  liqThresholdBps = 8_500n,
): bigint {
  if (debt <= 0n || sharePrice <= 0n || targetHf <= 0n) return 0n;
  const collValue = (collateralShares * sharePrice) / SCALE;
  const adjusted = (collValue * liqThresholdBps) / 10_000n;
  const maxDebt = (adjusted * SCALE) / targetHf; // floor → conservative
  if (debt <= maxDebt) return 0n;
  return debt - maxDebt;
}
