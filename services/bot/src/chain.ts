// Read-only chain access.
//
// The bot has no signing capability BY CONSTRUCTION, not by discipline: this
// facade wraps a LeontiefClient and re-exports only its read methods. The
// client's write methods (wrap/borrow/repay/liquidate) all require a `Signer`,
// and no Signer is ever constructed anywhere in this service — there is nothing
// in the process that can produce a signature. Adding one would mean editing
// this file, which is exactly where a reviewer will look.
import { ContractError, LeontiefClient, type NavData, type Position } from "@leontief/sdk";
import type { Config } from "./config.js";

export type NavRead = { ok: true; nav: bigint; ts: bigint } | { ok: false; reason: string };

/** Adapter error codes → the app's fail-closed vocabulary (app/src/hooks.ts). */
function navReason(code: number | null): string {
  if (code === 6) return "Stale";
  if (code === 7) return "Deviation";
  if (code === 4) return "Unconfigured";
  return "Halted";
}

export class ReadOnlyChain {
  private readonly client: LeontiefClient;

  constructor(readonly config: Config) {
    this.client = new LeontiefClient({
      rpcUrl: config.RPC_URL,
      networkPassphrase: config.NETWORK_PASSPHRASE,
      contracts: {
        vault: config.VAULT,
        miniPool: config.MINI_POOL,
        oracleAdapter: config.ORACLE_ADAPTER,
        underlyingSac: config.LEOD_SAC,
        debtSac: config.USDC_SAC,
      },
      assetId: config.ASSET_ID,
    });
  }

  sharePrice(): Promise<bigint> {
    return this.client.sharePrice();
  }
  totalAssetsValue(): Promise<bigint> {
    return this.client.totalAssetsValue();
  }
  ldBalance(account: string): Promise<bigint> {
    return this.client.ldBalance(account);
  }
  position(account: string): Promise<Position> {
    return this.client.positions(account);
  }
  healthFactor(account: string): Promise<bigint> {
    return this.client.healthFactor(account);
  }
  underlyingBalance(account: string): Promise<bigint> {
    return this.client.underlyingBalance(account);
  }
  debtBalance(account: string): Promise<bigint> {
    return this.client.debtBalance(account);
  }
  quoteShares(amount: bigint): Promise<bigint> {
    return this.client.quoteShares(amount);
  }
  /** Post-action HF preview, used to quote an intent before the user signs. */
  previewHealthFactor(account: string, dColl: bigint, dDebt: bigint): Promise<bigint | null> {
    return this.client.previewHealthFactor(account, dColl, dDebt);
  }

  /** NAV, surfacing the fail-closed halt reason instead of throwing — a halted
   *  oracle is a state the user must SEE, never a silently stale number. */
  async nav(): Promise<NavRead> {
    try {
      const d: NavData = await this.client.nav();
      return { ok: true, nav: d.nav, ts: d.ts };
    } catch (e) {
      const code = e instanceof ContractError ? e.code : null;
      return { ok: false, reason: navReason(code) };
    }
  }

  explorerAccount(address: string): string {
    return `${this.config.EXPLORER_BASE}/account/${address}`;
  }
}

/** Protocol-wide figures from the indexer's REST API (services/indexer). */
export async function fetchMetrics(indexerUrl: string): Promise<{
  unique_suppliers: number;
  active_borrowers: number;
  deployed_shares: string;
  total_debt: string;
  latest_share_price: string | null;
  lifetime: { deposits: number; withdrawals: number; borrows: number; liquidations: number };
} | null> {
  try {
    const res = await fetch(`${indexerUrl}/metrics`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return (await res.json()) as never;
  } catch {
    return null;
  }
}
