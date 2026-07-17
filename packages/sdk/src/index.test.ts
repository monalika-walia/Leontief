import { describe, expect, it } from "vitest";
import { quoteShares, SCALE, VIRT } from "./index.js";

describe("quoteShares (mirror of vault mint math, spec §3)", () => {
  it("first deposit at empty vault mints ~1:1", () => {
    expect(quoteShares(1_000_000_0n, 0n, 0n)).toBe(1_000_000_0n);
  });

  it("floors toward the user", () => {
    // 3 units into S=1000,V=2000 → 3*(1000+VIRT)/(2000+VIRT) = 6003/3000 → 2 (floor)
    expect(quoteShares(3n, 1_000n, 2_000n)).toBe(2n);
  });

  it("rejects non-positive input", () => {
    expect(() => quoteShares(0n, 0n, 0n)).toThrow(RangeError);
  });

  it("exports the shared constants", () => {
    expect(SCALE).toBe(1_000_000_000_000n);
    expect(VIRT).toBe(1_000n);
  });
});
