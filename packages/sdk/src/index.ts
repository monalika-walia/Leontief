/**
 * @leontief/sdk — scaffold placeholder. The real SDK (wrap/unwrap/quoteShares/
 * sharePrice/positions/healthFactor/liquidate over generated bindings) lands
 * with Phase A1 of leontief-build-prompts.md.
 */

/** Internal price scale shared with the contracts (spec §3). */
export const SCALE = 10n ** 12n;

/** Virtual-share offset applied to both mint and redeem legs (spec §3). */
export const VIRT = 10n ** 3n;

/** floor(shares) a deposit of `received` mints — mirrors vault math for previews. */
export function quoteShares(received: bigint, totalShares: bigint, totalValue: bigint): bigint {
  if (received <= 0n) throw new RangeError("received must be positive");
  return (received * (totalShares + VIRT)) / (totalValue + VIRT);
}
