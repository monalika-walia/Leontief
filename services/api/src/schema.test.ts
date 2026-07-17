import { describe, expect, it } from "vitest";
import { earlyAccessSchema } from "./schema.js";

describe("earlyAccessSchema", () => {
  it("accepts a minimal valid signup", () => {
    const r = earlyAccessSchema.safeParse({ email: "holder@example.com" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.source).toBe("landing");
  });

  it("accepts the full landing modal payload", () => {
    const r = earlyAccessSchema.safeParse({
      email: "ops@ondo.finance",
      role: "Issuer",
      assets: ["USDY", "USTRY"],
      handle: "@ondo",
      source: "landing",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a bad email", () => {
    expect(earlyAccessSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("rejects too many assets", () => {
    const assets = Array.from({ length: 21 }, (_, i) => `A${i}`);
    expect(earlyAccessSchema.safeParse({ email: "a@b.com", assets }).success).toBe(false);
  });

  it("fails when the honeypot is filled", () => {
    const r = earlyAccessSchema.safeParse({ email: "bot@spam.com", website: "http://spam" });
    // A filled honeypot fails the max(0) rule — the route treats any parse
    // result with a non-empty website as a bot and stores nothing.
    expect(r.success).toBe(false);
  });
});
