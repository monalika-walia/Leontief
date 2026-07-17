// Indexer config — contract IDs + RPC from env (project deploy.env with an
// INDEXER_ prefix, or plain names). Only the contracts we index are required.
const e = process.env;

export const RPC_URL = e.RPC_URL ?? "https://soroban-testnet.stellar.org";
export const PASSPHRASE = e.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

export const CONTRACTS = {
  vault: req("VAULT"),
  mini_pool: req("MINI_POOL"),
  oracle_adapter: req("ORACLE_ADAPTER"),
} as const;

export const ALL_CONTRACT_IDS = Object.values(CONTRACTS);
export const POLL_SECS = Number(e.POLL_SECS ?? 10);
// Public RPC keeps events ~days; if the cursor is lost, resume this far back.
export const BACKFILL_LEDGERS = Number(e.BACKFILL_LEDGERS ?? 17_000);
export const PORT = Number(e.INDEXER_PORT ?? 8788);

function req(k: string): string {
  const v = e[k];
  if (!v) {
    console.error(`indexer: missing required env ${k}`);
    process.exit(2);
  }
  return v;
}
