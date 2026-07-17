// Live-testnet smoke — runs only with LEONTIEF_LIVE=1 and the deploy.env vars
// exported (VAULT, MINI_POOL, ORACLE_ADAPTER, ALICE). Read-only: no keys needed.
import { describe, expect, it } from "vitest";
import { LeontiefClient } from "./client.js";
import { SCALE } from "./types.js";

const LIVE = process.env.LEONTIEF_LIVE === "1";
const maybe = LIVE ? describe : describe.skip;

maybe("live testnet smoke", () => {
  const client = new LeontiefClient({
    rpcUrl: process.env.RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    contracts: {
      vault: process.env.VAULT ?? "",
      miniPool: process.env.MINI_POOL ?? "",
      oracleAdapter: process.env.ORACLE_ADAPTER ?? "",
    },
    assetId: process.env.ASSET_ID ?? "LEOD",
  });

  it("reads a positive share price", async () => {
    const sp = await client.sharePrice();
    expect(sp).toBeGreaterThan(0n);
  });

  it("reads a fresh NAV", async () => {
    const nav = await client.nav();
    expect(nav.nav).toBeGreaterThan(0n);
  });

  it("quotes shares consistently with share price", async () => {
    const amount = 10_000_000n; // 1 unit
    const q = await client.quoteShares(amount);
    const sp = await client.sharePrice();
    // value(q · sp) ≈ value(amount · nav): within 1% for a small deposit.
    const nav = (await client.nav()).nav;
    const valueIn = (amount * nav) / SCALE;
    const valueOut = (q * sp) / SCALE;
    const diff = valueIn > valueOut ? valueIn - valueOut : valueOut - valueIn;
    expect(diff * 100n <= valueIn).toBe(true);
  });

  it("reads alice's position", async () => {
    const alice = process.env.ALICE;
    if (!alice) return;
    const pos = await client.positions(alice);
    expect(pos.collateral_shares).toBeGreaterThanOrEqual(0n);
  });
});
