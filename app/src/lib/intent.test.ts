import { describe, expect, it } from "vitest";
import { intentTarget, parseIntent, prefillAmount, prefillTab } from "./intent";

const q = (s: string) => new URLSearchParams(s);
const VAULT = "CB64EHOFGTWH2USSZP3PL2B66XJ4KD6A6C3SFXKPNTEO3NCIZFZWLHUS";

describe("parseIntent", () => {
  it("accepts every action the bot can send", () => {
    for (const action of ["wrap", "unwrap", "supply", "borrow", "repay"]) {
      const r = parseIntent(q(`action=${action}&asset=LEOD&amt=10.5`));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.intent).toEqual({ action, asset: "LEOD", amt: "10.5" });
    }
  });

  it("accepts an action with no amount (open the panel, fill nothing)", () => {
    const r = parseIntent(q("action=repay"));
    expect(r.ok).toBe(true);
  });

  // A link is user input: it can be hand-edited or forwarded by a stranger.
  it.each([
    ["no action", ""],
    ["unknown action", "action=liquidate&amt=1"],
    ["action that is not ours", "action=drain&amt=1"],
    ["negative amount", "action=borrow&amt=-5"],
    ["zero amount", "action=borrow&amt=0"],
    ["non-numeric amount", "action=borrow&amt=lots"],
    ["scientific notation", "action=borrow&amt=1e9"],
    ["sub-stroop precision", "action=borrow&amt=1.12345678"],
    ["path traversal in asset", "action=borrow&asset=../../evil"],
    ["script in asset", "action=borrow&asset=<script>"],
  ])("rejects %s with a readable problem, not a crash", (_name, query) => {
    const r = parseIntent(q(query));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.length).toBeGreaterThan(0);
  });
});

describe("intentTarget", () => {
  it("routes pool actions to /borrow with the tab and amount seeded", () => {
    expect(intentTarget({ action: "borrow", amt: "25" }, VAULT)).toBe("/borrow?amt=25&tab=borrow");
    expect(intentTarget({ action: "repay" }, VAULT)).toBe("/borrow?tab=repay");
  });
  it("routes vault actions to the vault panel", () => {
    expect(intentTarget({ action: "wrap", amt: "10" }, VAULT)).toBe(
      `/vaults/${VAULT}?amt=10&tab=wrap`,
    );
  });
  it("never routes outside the app", () => {
    for (const action of ["wrap", "unwrap", "supply", "borrow", "repay"] as const) {
      expect(intentTarget({ action }, VAULT).startsWith("/")).toBe(true);
    }
  });
});

describe("prefill helpers ignore anything they would refuse", () => {
  it("passes through valid amounts only", () => {
    expect(prefillAmount(q("amt=12.5"))).toBe("12.5");
    expect(prefillAmount(q("amt=-1"))).toBe("");
    expect(prefillAmount(q("amt=abc"))).toBe("");
    expect(prefillAmount(q(""))).toBe("");
  });
  it("passes through known tabs only", () => {
    const tabs = ["supply", "borrow"] as const;
    expect(prefillTab(q("tab=borrow"), tabs)).toBe("borrow");
    expect(prefillTab(q("tab=withdrawAll"), tabs)).toBeNull();
    expect(prefillTab(q(""), tabs)).toBeNull();
  });
});
