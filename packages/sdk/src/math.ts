// Pure client-side previews (labelled ≈ in UIs). The contracts are the source
// of truth and enforce exact amounts/bounds on submit; these mirror their
// integer math for display and pre-flight checks. Unit-tested against the same
// values as the repo's golden vectors.
import { POOL_PARAMS, SCALE } from "./types.js";

/** Shares minted for `received` underlying at `nav`, given vault totals
 *  (value-consistent legs, DECISIONS #3; VIRT = 10^3 both legs). */
export function quoteShares(
  received: bigint,
  nav: bigint,
  balBefore: bigint,
  totalShares: bigint,
): bigint {
  const VIRT = 1_000n;
  if (received <= 0n || nav <= 0n) return 0n;
  const vBefore = (balBefore * nav) / SCALE;
  const valueIn = (received * nav) / SCALE;
  return (valueIn * (totalShares + VIRT)) / (vBefore + VIRT);
}

/** Underlying returned for `shares` at `nav`, given vault totals. */
export function quoteWithdraw(
  shares: bigint,
  nav: bigint,
  balance: bigint,
  totalShares: bigint,
): bigint {
  const VIRT = 1_000n;
  if (shares <= 0n || nav <= 0n) return 0n;
  const v = (balance * nav) / SCALE;
  const valueOut = (shares * (v + VIRT)) / (totalShares + VIRT);
  const amount = (valueOut * SCALE) / nav;
  return amount < balance ? amount : balance;
}

/** SCALE-scaled health factor estimate from a position + share price.
 *  Returns null when debt-free (the contract returns i128::MAX). */
export function healthFactor(
  collateralShares: bigint,
  debt: bigint,
  sharePrice: bigint,
): bigint | null {
  if (debt <= 0n) return null;
  const collValue = (collateralShares * sharePrice) / SCALE;
  const adjusted = (collValue * POOL_PARAMS.liqThresholdBps) / POOL_PARAMS.bps;
  return (adjusted * SCALE) / debt;
}

/** Shares a liquidator seizes for `repay` at `sharePrice` (protocol-side ceil). */
export function quoteSeize(repay: bigint, sharePrice: bigint): bigint {
  if (repay <= 0n || sharePrice <= 0n) return 0n;
  const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
  const bonusValue = ceilDiv(repay * (POOL_PARAMS.bps + POOL_PARAMS.liqBonusBps), POOL_PARAMS.bps);
  return ceilDiv(bonusValue * SCALE, sharePrice);
}
