import { describe, expect, it } from "vitest";
import { computeAtRisk, healthFactor, SCALE, type Snapshot } from "./risk.js";

// Recorded fixture: three positions at a crashed share price of 0.90.
const SP = (SCALE * 90n) / 100n; // 0.90
const FIXTURE: Snapshot[] = [
  { account: "GHEALTHY", collateral_shares: 5_000_000_000n, debt: 1_000_000_000n }, // hf high
  { account: "GRISKY", collateral_shares: 5_000_000_000n, debt: 4_000_000_000n }, // hf < 1
  { account: "GNODEBT", collateral_shares: 3_000_000_000n, debt: 0n }, // excluded
];

describe("healthFactor", () => {
  it("is +Inf with no debt", () => {
    expect(healthFactor(1_000_000_000n, 0n, SP)).toBe(Number.POSITIVE_INFINITY);
  });
  it("matches the mini-pool formula at 0.90", () => {
    // coll 500 · 0.90 = 450 ; ×0.85 = 382.5 ; / debt 400 = 0.95625
    const hf = healthFactor(5_000_000_000n, 4_000_000_000n, SP);
    expect(hf).toBeGreaterThan(0.95);
    expect(hf).toBeLessThan(0.96);
  });
});

describe("computeAtRisk", () => {
  it("returns only debt-bearing positions below the hf bound, sorted", () => {
    const out = computeAtRisk(FIXTURE, SP, 1.1);
    expect(out.map((p) => p.account)).toEqual(["GRISKY"]);
    expect(out[0].hf).toBeLessThan(1);
  });
  it("excludes zero-debt positions entirely", () => {
    const out = computeAtRisk(FIXTURE, SP, 100);
    expect(out.find((p) => p.account === "GNODEBT")).toBeUndefined();
    expect(out.map((p) => p.account)).toEqual(["GRISKY", "GHEALTHY"]); // ascending hf
  });
});
