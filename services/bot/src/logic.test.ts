import { describe, expect, it } from "vitest";
import { type AlertBand, decide, HYSTERESIS, nextBand } from "./alertLogic.js";
import { amt, hfBand, hfLine, hfNumber, parseAmount, SCALE, scaled } from "./format.js";
import { INTENT_ACTIONS, intentUrl, isIntentAction } from "./intents.js";

const T = { warn: 1.5, urgent: 1.2 };

describe("hfBand — same vocabulary as the app's gauge", () => {
  it("maps the gauge's thresholds", () => {
    expect(hfBand(Number.POSITIVE_INFINITY)).toBe("NO DEBT");
    expect(hfBand(2.0)).toBe("SAFE");
    expect(hfBand(1.5)).toBe("SAFE"); // solid at >= 1.5
    expect(hfBand(1.4999)).toBe("MODERATE");
    expect(hfBand(1.1)).toBe("MODERATE"); // hatched band is [1.1, 1.5)
    expect(hfBand(1.0999)).toBe("AT RISK");
    expect(hfBand(0.5)).toBe("AT RISK");
    expect(hfBand(null)).toBe("—");
  });
  it("always carries a word, never a colour alone", () => {
    for (const hf of [0.4, 1.05, 1.3, 1.9]) {
      expect(hfLine(BigInt(Math.round(hf * 1e12)))).toMatch(/SAFE|MODERATE|AT RISK/);
    }
    expect(hfLine(SCALE * 10_000_000n)).toContain("NO DEBT");
  });
});

describe("formatting mirrors the dApp", () => {
  it("formats amounts and scaled values", () => {
    expect(amt(1_234_500_0000n)).toBe("1,234.5000");
    expect(amt(0n)).toBe("0.0000");
    expect(amt(undefined)).toBe("—");
    expect(scaled(1_000_763_927_216n)).toBe("1.0007");
  });
  it("treats the debt-free sentinel as infinity", () => {
    expect(hfNumber(SCALE * 2n)).toBe(2);
    expect(hfNumber(SCALE * 1_000_001n)).toBe(Number.POSITIVE_INFINITY);
  });
  it("parses amounts strictly, rejecting anything it would have to guess at", () => {
    expect(parseAmount("12.5")).toBe(125_000_000n);
    expect(parseAmount(" 1,000 ")).toBe(10_000_000_000n);
    expect(parseAmount("0.0000001")).toBe(1n);
    for (const bad of ["", "0", "-5", "abc", "1.23456789", "1e5", "NaN", "Infinity", "1.2.3"]) {
      expect(parseAmount(bad)).toBeNull();
    }
  });
});

describe("intent links", () => {
  const base = "https://app.leontief.tech";
  it("builds a link for every supported action", () => {
    for (const action of INTENT_ACTIONS) {
      const url = intentUrl(base, { action, asset: "LEOD", amt: "10" });
      expect(url).toBe(`${base}/intent?action=${action}&asset=LEOD&amt=10`);
    }
  });
  it("omits absent params", () => {
    expect(intentUrl(base, { action: "borrow" })).toBe(`${base}/intent?action=borrow`);
  });
  it("refuses anything it cannot vouch for", () => {
    expect(intentUrl(base, { action: "drain" as never })).toBeNull();
    expect(intentUrl(base, { action: "borrow", amt: "-1" })).toBeNull();
    expect(intentUrl(base, { action: "borrow", amt: "0" })).toBeNull();
    expect(intentUrl(base, { action: "borrow", amt: "1.23456789" })).toBeNull();
    expect(intentUrl(base, { action: "borrow", asset: "../../evil" })).toBeNull();
    expect(isIntentAction("liquidate")).toBe(false);
  });
  it("cannot be talked into pointing at another host", () => {
    // Params are set via URLSearchParams, so injection lands in the query, not
    // in the origin.
    const url = new URL(intentUrl(base, { action: "borrow", asset: "LEOD" }) as string);
    expect(url.origin).toBe(base);
  });
});

describe("nextBand — hysteresis", () => {
  it("worsens immediately", () => {
    expect(nextBand(1.49, "ok", T)).toBe("warn");
    expect(nextBand(1.19, "warn", T)).toBe("urgent");
    expect(nextBand(0.9, null, T)).toBe("urgent");
  });
  it("does not flap when the HF hovers on a threshold", () => {
    let band: AlertBand | null = "ok";
    const alerts: AlertBand[] = [];
    // Oscillate tightly around warn = 1.5.
    for (const hf of [1.499, 1.501, 1.498, 1.502, 1.4995, 1.5005]) {
      const next = nextBand(hf, band, T);
      if (next !== band) alerts.push(next);
      band = next;
    }
    expect(alerts).toEqual(["warn"]); // one alert, not six
  });
  it("recovers only after clearing the threshold by the margin", () => {
    expect(nextBand(1.5, "warn", T)).toBe("warn"); // at the line: still warned
    expect(nextBand(1.5 * (1 + HYSTERESIS) - 0.001, "warn", T)).toBe("warn");
    expect(nextBand(1.5 * (1 + HYSTERESIS), "warn", T)).toBe("ok");
    expect(nextBand(1.2 * (1 + HYSTERESIS), "urgent", T)).toBe("warn");
  });
});

describe("decide — delivery", () => {
  const now = 1_000_000;
  it("stays quiet when nothing changed", () => {
    expect(
      decide({ prev: "warn", next: "warn", paused: false, lastSentAtMs: null, nowMs: now }),
    ).toEqual({ send: false, reason: "unchanged" });
  });
  it("does not announce a healthy position on first sight", () => {
    expect(
      decide({ prev: null, next: "ok", paused: false, lastSentAtMs: null, nowMs: now }),
    ).toEqual({ send: false, reason: "unchanged" });
  });
  it("rate-limits non-urgent alerts to one a minute", () => {
    const d = decide({
      prev: "ok",
      next: "warn",
      paused: false,
      lastSentAtMs: now - 30_000,
      nowMs: now,
    });
    expect(d).toEqual({ send: false, reason: "rate-limited" });
  });
  it("never rate-limits urgent", () => {
    const d = decide({
      prev: "warn",
      next: "urgent",
      paused: false,
      lastSentAtMs: now - 1_000,
      nowMs: now,
    });
    expect(d).toEqual({ send: true, band: "urgent", recovered: false });
  });
  it("reports recovery", () => {
    const d = decide({ prev: "warn", next: "ok", paused: false, lastSentAtMs: null, nowMs: now });
    expect(d).toEqual({ send: true, band: "ok", recovered: true });
  });
  it("respects a paused user", () => {
    const d = decide({
      prev: "ok",
      next: "urgent",
      paused: true,
      lastSentAtMs: null,
      nowMs: now,
    });
    expect(d).toEqual({ send: false, reason: "paused" });
  });
});
