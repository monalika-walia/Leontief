// Pure at-risk computation, shared by the API and unit-tested against a fixture.
// hf = collateral_value · liq_threshold / BPS · SCALE / debt, using the latest
// sampled share_price. Mirrors the mini-pool formula (the contract is
// authoritative at liquidation time; this is the monitoring estimate).
export const SCALE = 1_000_000_000_000n;
export const LIQ_THRESHOLD_BPS = 8500n;

export type Snapshot = { account: string; collateral_shares: bigint; debt: bigint };
export type AtRisk = { account: string; collateral_shares: string; debt: string; hf: number };

export function healthFactor(coll: bigint, debt: bigint, sharePrice: bigint): number {
  if (debt <= 0n) return Number.POSITIVE_INFINITY;
  const collValue = (coll * sharePrice) / SCALE;
  const adjusted = (collValue * LIQ_THRESHOLD_BPS) / 10_000n;
  return Number((adjusted * SCALE) / debt) / Number(SCALE);
}

export function computeAtRisk(snaps: Snapshot[], sharePrice: bigint, hfLt: number): AtRisk[] {
  return snaps
    .filter((s) => s.debt > 0n)
    .map((s) => ({
      account: s.account,
      collateral_shares: s.collateral_shares.toString(),
      debt: s.debt.toString(),
      hf: healthFactor(s.collateral_shares, s.debt, sharePrice),
    }))
    .filter((p) => p.hf < hfLt)
    .sort((a, b) => a.hf - b.hf);
}
