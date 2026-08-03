// Strategies propose; policy.ts disposes. Nothing here signs, and nothing here
// is trusted — every proposal goes through checkPolicy() and a pre-flight
// simulation before it becomes a transaction.
//
// Each strategy is opt-in per user. The default is digest-only, which never
// proposes anything at all.
import { type ProposedAction, repayToRestore, SCALE } from "./policy.js";

export type UserState = {
  /** Wallet balance of the debt asset (USDC), 7-dec. */
  idleDebtAsset: bigint;
  /** Wallet balance of the vault's underlying (the mirror asset), 7-dec. */
  idleUnderlying: bigint;
  collateralShares: bigint;
  debt: bigint;
  sharePrice: bigint;
  /** Current health factor, SCALE-scaled; null when debt-free. */
  hf: bigint | null;
};

export type StrategyConfig = {
  vault: string;
  miniPool: string;
  /** Sweep only when idle underlying exceeds this. */
  sweepThreshold: bigint;
  /** Restore to this HF, comfortably above the 1.6 floor. */
  guardTarget: bigint;
  /** Act when HF drops below this. */
  guardTrigger: bigint;
};

/**
 * idle-sweep — idle mirror-asset holdings above a threshold get wrapped into
 * ld-shares so they earn instead of sitting still.
 *
 * Deliberately narrower than A7's single-user loop: that script ACQUIRED the
 * mirror asset from a testnet desk before wrapping. Buying an asset on a user's
 * behalf is a different and much larger permission than wrapping what they
 * already hold, so the multi-user engine does not do it.
 */
export function idleSweep(s: UserState, c: StrategyConfig): ProposedAction | null {
  if (s.idleUnderlying <= c.sweepThreshold) return null;
  return { kind: "wrap", amount: s.idleUnderlying, contractId: c.vault };
}

/**
 * hf-guard — repay from idle USDC to pull a slipping position back up. This is
 * the strategy that pairs with the Tier-1 alerts: instead of waking the user at
 * 3am, it fixes the thing the alert would have been about.
 *
 * It never borrows, never sells collateral, and never repays more than the user
 * has idle.
 */
export function hfGuard(s: UserState, c: StrategyConfig): ProposedAction | null {
  if (s.debt <= 0n || s.hf === null) return null;
  if (s.hf >= c.guardTrigger) return null;

  const needed = repayToRestore(s.collateralShares, s.debt, s.sharePrice, c.guardTarget);
  if (needed <= 0n) return null;

  // Repay what we can afford; a partial repayment still improves the HF.
  const amount = needed < s.idleDebtAsset ? needed : s.idleDebtAsset;
  if (amount <= 0n) return null;
  return { kind: "repay", amount, contractId: c.miniPool };
}

export type StrategyName = "idle-sweep" | "hf-guard" | "digest-only";

/** Resolve a user's opted-in strategy to a proposal (or nothing). */
export function propose(
  strategy: StrategyName,
  s: UserState,
  c: StrategyConfig,
): ProposedAction | null {
  if (strategy === "idle-sweep") return idleSweep(s, c);
  if (strategy === "hf-guard") return hfGuard(s, c);
  return null; // digest-only reports; it does not act
}

export const DEFAULT_STRATEGY_CONFIG = {
  sweepThreshold: 10n * 10_000_000n, // 10 units
  guardTrigger: (SCALE * 17n) / 10n, // act below 1.7
  guardTarget: (SCALE * 20n) / 10n, // restore to 2.0
} as const;
