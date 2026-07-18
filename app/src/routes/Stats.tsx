import { useApp } from "../ctx";
import {
  usePoolCollateral,
  usePoolLiquidity,
  useSharePrice,
  useTotalAssets,
  useVaultTotals,
} from "../hooks";
import { amt, scaled } from "../lib/format";

/** /stats — public metrics. Every figure links to the contract it came from. */
export function Stats() {
  const { env } = useApp();
  const tvl = useTotalAssets();
  const shares = useVaultTotals();
  const price = useSharePrice();
  const deployed = usePoolCollateral();
  const liquidity = usePoolLiquidity();

  const totalShares = shares.data?.totalShares ?? 0n;
  // Utility ratio — the KPI: shares deployed as collateral / total shares.
  const utilityPct =
    totalShares > 0n && deployed.data !== undefined
      ? Number((deployed.data * 10_000n) / totalShares) / 100
      : 0;
  const capPct =
    shares.data?.cap && shares.data.cap > 0n && tvl.data
      ? Number((tvl.data * 10_000n) / shares.data.cap) / 100
      : 0;

  const cx = (id: string) => `${env.EXPLORER_BASE}/contract/${id}`;

  return (
    <div className="col" style={{ gap: 28 }}>
      <div>
        <div className="label mono">Protocol metrics · testnet · live from chain</div>
        <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 34 }}>
          Onchain growth
        </h1>
      </div>

      <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
        <Metric
          label="Total value wrapped (TVL)"
          value={tvl.data !== undefined ? `$${amt(tvl.data, 2)}` : "…"}
          src={cx(env.VAULT_LEOD)}
          srcName="vault.total_assets_value"
        />
        <Metric
          label="Utility ratio · THE KPI"
          value={`${utilityPct.toFixed(1)}%`}
          src={cx(env.MINI_POOL)}
          srcName="vault.balance(pool) / total_shares"
          big
        />
        <Metric
          label="Share price"
          value={price.data !== undefined ? scaled(price.data) : "…"}
          src={cx(env.VAULT_LEOD)}
          srcName="vault.share_price"
        />
      </div>

      <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
        <Metric
          label="Total wrapped (ld-shares)"
          value={amt(totalShares)}
          src={cx(env.VAULT_LEOD)}
          srcName="vault.total_shares"
        />
        <Metric
          label="Deployed as collateral"
          value={amt(deployed.data)}
          src={cx(env.MINI_POOL)}
          srcName="vault.balance(pool)"
        />
        <Metric
          label="Cap utilization"
          value={`${capPct.toFixed(1)}%`}
          src={cx(env.VAULT_LEOD)}
          srcName="TVL / cap"
        />
        <Metric
          label="Borrow liquidity (USDC)"
          value={amt(liquidity.data)}
          src={cx(env.USDC_SAC)}
          srcName="usdc.balance(pool)"
        />
      </div>

      <div className="panel">
        <h3>90-day targets</h3>
        <div className="row between" style={{ marginTop: 10, flexWrap: "wrap", gap: 16 }}>
          <Target label="Wrapped AUM" now={`$${amt(tvl.data, 0)}`} goal="$15–40M" />
          <Target label="Utility ratio" now={`${utilityPct.toFixed(0)}%`} goal="≥ 30%" />
          <Target label="External integrations" now="0" goal="2+ (Blend, Aquarius)" />
        </div>
        <div className="label" style={{ marginTop: 14 }}>
          Unique suppliers · share-price history · borrow volume · liquidation log come from the
          indexer (A3); this page reads current state directly from chain.
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  src,
  srcName,
  big,
}: {
  label: string;
  value: string;
  src: string;
  srcName: string;
  big?: boolean;
}) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 200 }}>
      <div className="label">{label}</div>
      <div className="fig" style={{ marginTop: 6, fontSize: big ? 44 : undefined }}>
        {value}
      </div>
      <a
        className="label mono"
        href={src}
        target="_blank"
        rel="noreferrer"
        title={srcName}
        style={{ textDecoration: "underline", fontSize: 10 }}
      >
        {srcName} ↗
      </a>
    </div>
  );
}

function Target({ label, now, goal }: { label: string; now: string; goal: string }) {
  return (
    <div style={{ minWidth: 150 }}>
      <div className="label">{label}</div>
      <div className="mono" style={{ fontSize: 18 }}>
        {now} <span className="dim">/ {goal}</span>
      </div>
    </div>
  );
}
