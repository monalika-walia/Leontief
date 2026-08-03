// Pure alerting decisions — no I/O, so the awkward parts (hysteresis, rate
// limiting, urgency override) are unit-testable without a bot token or a chain.
export type AlertBand = "ok" | "warn" | "urgent";

export type Thresholds = { warn: number; urgent: number };

/** Recovery must clear a threshold by this margin before we call it a recovery.
 *  Without it, an HF oscillating around 1.500 pages the user all afternoon. */
export const HYSTERESIS = 0.02; // 2%

/**
 * Band for `hf`, given where the user already was.
 *
 * Worsening is immediate — crossing down through a threshold always counts.
 * Improving is sticky — the HF must clear the threshold by HYSTERESIS before we
 * report the better band. Boundary noise therefore produces exactly one alert.
 */
export function nextBand(hf: number, prev: AlertBand | null, t: Thresholds): AlertBand {
  const clears = (threshold: number) => hf >= threshold * (1 + HYSTERESIS);

  if (hf < t.urgent) return "urgent";
  if (prev === "urgent" && !clears(t.urgent)) return "urgent";
  if (hf < t.warn) return "warn";
  if ((prev === "warn" || prev === "urgent") && !clears(t.warn)) return "warn";
  return "ok";
}

export type Decision =
  | { send: false; reason: "unchanged" | "rate-limited" | "paused" }
  | { send: true; band: AlertBand; recovered: boolean };

/**
 * Whether to actually deliver, given the band change and the delivery history.
 *
 * Rate limit: at most one message per chat per minute — except `urgent`, which
 * is the one case where being noisy is correct (spec: "max 1 msg/user/minute
 * except urgent HF").
 */
export function decide(args: {
  prev: AlertBand | null;
  next: AlertBand;
  paused: boolean;
  lastSentAtMs: number | null;
  nowMs: number;
  minGapMs?: number;
}): Decision {
  const { prev, next, paused, lastSentAtMs, nowMs } = args;
  const minGapMs = args.minGapMs ?? 60_000;

  if (next === prev) return { send: false, reason: "unchanged" };
  // First sighting of a healthy position is not news.
  if (prev === null && next === "ok") return { send: false, reason: "unchanged" };
  if (paused) return { send: false, reason: "paused" };

  const recovered = next === "ok";
  if (next !== "urgent" && lastSentAtMs !== null && nowMs - lastSentAtMs < minGapMs) {
    return { send: false, reason: "rate-limited" };
  }
  return { send: true, band: next, recovered };
}

/** Oracle events broadcast to every verified user of the vault (spec §5 states). */
export const ORACLE_EVENT_TOPICS = new Set(["halted", "override_accepted", "paused", "unpaused"]);
