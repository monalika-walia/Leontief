import { rpc } from "@stellar/stellar-sdk";
import { healthFactor as hfEstimate, quoteShares as quoteSharesMath } from "./math.js";
import { type Arg, ContractError, simulateRead, submit } from "./tx.js";
import { type LeontiefConfig, type NavData, type Position, SCALE, type Signer } from "./types.js";

const addr = (a: string): Arg => ({ addr: a });
const i128 = (v: bigint): Arg => ({ i128: v });
const sym = (s: string): Arg => ({ sym: s });

export type TxResult = { hash: string; returnValue: unknown };

/**
 * The one client. Reads go through `simulateTransaction` (no keys needed);
 * writes take any {@link Signer}. Amounts are 7-dec integers (stroops);
 * NAV/share_price are SCALE = 10^12.
 */
export class LeontiefClient {
  readonly server: rpc.Server;
  constructor(readonly config: LeontiefConfig) {
    this.server = new rpc.Server(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith("http://"),
    });
  }

  private read<T>(contractId: string, method: string, ...args: Arg[]): Promise<T> {
    return simulateRead<T>(this.server, this.config.networkPassphrase, contractId, method, args);
  }
  private write(
    signer: Signer,
    contractId: string,
    method: string,
    ...args: Arg[]
  ): Promise<TxResult> {
    return submit(this.server, this.config.networkPassphrase, signer, contractId, method, args);
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /** Quote value of one share, SCALE-scaled. Throws ContractError on oracle halt. */
  sharePrice(): Promise<bigint> {
    return this.read<bigint>(this.config.contracts.vault, "share_price");
  }

  /** Pool value in quote units (7-dec). */
  totalAssetsValue(): Promise<bigint> {
    return this.read<bigint>(this.config.contracts.vault, "total_assets_value");
  }

  /** Fail-closed NAV from the adapter. Throws ContractError (code = Stale/Deviation/…) on halt. */
  nav(): Promise<NavData> {
    return this.read<NavData>(
      this.config.contracts.oracleAdapter,
      "get_nav",
      sym(this.config.assetId),
    );
  }

  /** ld-share balance. */
  ldBalance(account: string): Promise<bigint> {
    return this.read<bigint>(this.config.contracts.vault, "balance", addr(account));
  }

  /** Pool position (zeroes when none). */
  positions(account: string): Promise<Position> {
    return this.read<Position>(this.config.contracts.miniPool, "position", addr(account));
  }

  /** SCALE-scaled health factor (i128::MAX when debt-free). */
  healthFactor(account: string): Promise<bigint> {
    return this.read<bigint>(this.config.contracts.miniPool, "health_factor", addr(account));
  }

  isWhitelisted(account: string): Promise<boolean> {
    return this.read<boolean>(this.config.contracts.miniPool, "is_whitelisted", addr(account));
  }

  /** ≈ shares a deposit would mint right now (client-side preview; the mint is
   *  exact on-chain). Combines live nav + vault totals. */
  async quoteShares(amount: bigint): Promise<bigint> {
    const [navData, totalShares, totalValue] = await Promise.all([
      this.nav(),
      this.read<bigint>(this.config.contracts.vault, "total_shares"),
      this.totalAssetsValue(),
    ]);
    // Reconstruct the underlying balance from value/nav (exact enough for preview).
    const balBefore = navData.nav > 0n ? (totalValue * SCALE) / navData.nav : 0n;
    return quoteSharesMath(amount, navData.nav, balBefore, totalShares);
  }

  /** ≈ post-action health factor (null = debt-free). */
  async previewHealthFactor(
    account: string,
    deltaCollateral: bigint,
    deltaDebt: bigint,
  ): Promise<bigint | null> {
    const [pos, price] = await Promise.all([this.positions(account), this.sharePrice()]);
    return hfEstimate(pos.collateral_shares + deltaCollateral, pos.debt + deltaDebt, price);
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  /** Deposit underlying → mint ld-shares. Returns minted shares. */
  wrap(signer: Signer, amount: bigint): Promise<TxResult> {
    return this.write(
      signer,
      this.config.contracts.vault,
      "deposit",
      addr(signer.address),
      i128(amount),
    );
  }

  /** Burn ld-shares → receive underlying. Returns amount paid out. */
  unwrap(signer: Signer, shares: bigint): Promise<TxResult> {
    return this.write(
      signer,
      this.config.contracts.vault,
      "withdraw",
      addr(signer.address),
      i128(shares),
    );
  }

  supplyCollateral(signer: Signer, shares: bigint): Promise<TxResult> {
    return this.write(
      signer,
      this.config.contracts.miniPool,
      "supply_collateral",
      addr(signer.address),
      i128(shares),
    );
  }

  withdrawCollateral(signer: Signer, shares: bigint): Promise<TxResult> {
    return this.write(
      signer,
      this.config.contracts.miniPool,
      "withdraw_collateral",
      addr(signer.address),
      i128(shares),
    );
  }

  borrow(signer: Signer, amount: bigint): Promise<TxResult> {
    return this.write(
      signer,
      this.config.contracts.miniPool,
      "borrow",
      addr(signer.address),
      i128(amount),
    );
  }

  repay(signer: Signer, amount: bigint): Promise<TxResult> {
    return this.write(
      signer,
      this.config.contracts.miniPool,
      "repay",
      addr(signer.address),
      i128(amount),
    );
  }

  /** Whitelisted-only. Returns seized shares in `returnValue`. */
  liquidate(signer: Signer, user: string, repay: bigint): Promise<TxResult> {
    return this.write(
      signer,
      this.config.contracts.miniPool,
      "liquidate",
      addr(signer.address),
      addr(user),
      i128(repay),
    );
  }
}

export { ContractError };
