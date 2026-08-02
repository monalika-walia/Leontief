// Presentation helpers. Mirrors app/src/lib/format.ts so a number reads the same
// in Telegram as it does in the dApp, and app/src/components/HealthGauge.tsx so
// the risk vocabulary matches too.
//
// Telegram is text-only, which makes the app's "never colors-only" rule free:
// every band carries a WORD. Nothing here depends on a colour or an emoji.
export const STROOP = 10_000_000n;
export const SCALE = 1_000_000_000_000n;

/** 7-dec token amount → human string. */
export function amt(v: bigint | undefined, dp = 4): string {
  if (v === undefined) return "—";
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / STROOP;
  const frac = (a % STROOP).toString().padStart(7, "0").slice(0, dp);
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${dp > 0 ? `.${frac}` : ""}`;
}

/** SCALE-scaled value (share price, NAV) → human string. */
export function scaled(v: bigint | undefined, dp = 4): string {
  if (v === undefined) return "—";
  const whole = v / SCALE;
  const frac = (v % SCALE).toString().padStart(12, "0").slice(0, dp);
  return `${whole}.${frac}`;
}

/** SCALE-scaled HF → number; the contract's i128::MAX debt-free sentinel → ∞. */
export function hfNumber(v: bigint | undefined): number | null {
  if (v === undefined) return null;
  if (v > SCALE * 1_000_000n) return Number.POSITIVE_INFINITY;
  return Number(v) / Number(SCALE);
}

export type Band = "NO DEBT" | "SAFE" | "MODERATE" | "AT RISK";

/** The app's gauge bands, in words: solid ≥1.5, hatched 1.1–1.5, AT RISK <1.1. */
export function hfBand(hf: number | null): Band | "—" {
  if (hf === null) return "—";
  if (hf === Number.POSITIVE_INFINITY) return "NO DEBT";
  if (hf < 1.1) return "AT RISK";
  if (hf < 1.5) return "MODERATE";
  return "SAFE";
}

export function hfLine(hf: bigint | undefined): string {
  const n = hfNumber(hf);
  if (n === null) return "Health factor: —";
  if (n === Number.POSITIVE_INFINITY) return "Health factor: ∞ · NO DEBT";
  return `Health factor: ${n.toFixed(3)} · ${hfBand(n)}`;
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

/** Parse a user-typed amount ("12.5") into 7-dec stroops. Null when unusable —
 *  the bot never guesses at a number it will put in front of a signing prompt. */
export function parseAmount(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d{1,15}(\.\d{1,7})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const v = BigInt(whole) * STROOP + BigInt((frac + "0000000").slice(0, 7));
  return v > 0n ? v : null;
}
