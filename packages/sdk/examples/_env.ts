// Shared example bootstrap: run `source deploy.env` (repo root) first, then
// `pnpm exec tsx packages/sdk/examples/<name>.ts`.
import { LeontiefClient } from "../src/index.js";

export function clientFromEnv(): LeontiefClient {
  const req = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`missing env ${k} — source deploy.env first`);
    return v;
  };
  return new LeontiefClient({
    rpcUrl: process.env.RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    contracts: {
      vault: req("VAULT"),
      miniPool: req("MINI_POOL"),
      oracleAdapter: req("ORACLE_ADAPTER"),
      underlyingSac: process.env.LEOD_SAC,
      debtSac: process.env.USDC_SAC,
    },
    assetId: process.env.ASSET_ID ?? "LEOD",
  });
}

export function fmt(v: bigint, dp = 7): string {
  const s = v.toString().padStart(dp + 1, "0");
  return `${s.slice(0, -dp)}.${s.slice(-dp)}`;
}
