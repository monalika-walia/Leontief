import { hfNumber } from "../lib/format";

/**
 * Monochrome health-factor gauge (no red/green). Fill intensity + pattern encode
 * risk: solid ≥1.5, hatched 1.1–1.5, inverted + pulsing + "AT RISK" label <1.1.
 * Ticks at 1.0 and 1.5. The bar maps hf ∈ [0,2] across the width.
 */
export function HealthGauge({ hf }: { hf: bigint | undefined }) {
  const n = hfNumber(hf);
  const label = n === null ? "—" : n === Number.POSITIVE_INFINITY ? "∞ (no debt)" : n.toFixed(2);
  const atRisk = n !== null && n !== Number.POSITIVE_INFINITY && n < 1.1;
  const hatched = n !== null && n !== Number.POSITIVE_INFINITY && n >= 1.1 && n < 1.5;
  const pct =
    n === null
      ? 0
      : n === Number.POSITIVE_INFINITY
        ? 100
        : Math.max(0, Math.min(100, (n / 2) * 100));

  const cls = `fillbar ${hatched ? "hatch" : ""} ${atRisk ? "risk" : ""}`;
  return (
    <div>
      <div className="row between center">
        <span className="gauge-label">Health factor</span>
        <span className="fig sm" aria-label={`health factor ${label}`}>
          {atRisk ? `${label} · AT RISK` : label}
        </span>
      </div>
      <div
        className="gauge"
        role="meter"
        aria-valuenow={n === Number.POSITIVE_INFINITY ? 999 : (n ?? 0)}
        aria-valuemin={0}
        aria-valuemax={2}
        aria-label="health factor gauge, liquidation at 1.0"
      >
        <div className={cls} style={{ width: `${pct}%` }} />
        {/* threshold ticks at hf = 1.0 (50%) and 1.5 (75%) */}
        <div className="tick" style={{ left: "50%" }}>
          <span className="ticklabel">1.0</span>
        </div>
        <div className="tick" style={{ left: "75%" }}>
          <span className="ticklabel">1.5</span>
        </div>
      </div>
      <div className="label">
        Below 1.0, the position may be liquidated by a whitelisted liquidator.
      </div>
    </div>
  );
}
