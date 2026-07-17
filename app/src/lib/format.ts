// Formatting for on-chain integer values. Contract amounts are 7-dec (stroops);
// share_price / NAV are SCALE = 10^12.
export const STROOP = 10_000_000n; // 10^7
export const SCALE = 1_000_000_000_000n; // 10^12

/** 7-dec token amount → human string. */
export function amt(v: bigint | undefined, dp = 4): string {
  if (v === undefined) return "—";
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / STROOP;
  const frac = (a % STROOP).toString().padStart(7, "0").slice(0, dp);
  return `${neg ? "-" : ""}${whole.toLocaleString()}${dp > 0 ? "." + frac : ""}`;
}

/** SCALE-scaled value (share_price, NAV) → human string, e.g. 1.0209. */
export function scaled(v: bigint | undefined, dp = 4): string {
  if (v === undefined) return "—";
  const whole = v / SCALE;
  const frac = (v % SCALE).toString().padStart(12, "0").slice(0, dp);
  return `${whole}.${frac}`;
}

/** Health factor (SCALE-scaled) → number for gauge math; caps the i128::MAX sentinel. */
export function hfNumber(v: bigint | undefined): number | null {
  if (v === undefined) return null;
  if (v > SCALE * 1_000_000n) return Number.POSITIVE_INFINITY; // debt-free sentinel
  return Number(v) / Number(SCALE);
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

export function ageLabel(tsSec: bigint | number, nowSec = Math.floor(Date.now() / 1000)): string {
  const s = nowSec - Number(tsSec);
  if (s < 0) return "future";
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
