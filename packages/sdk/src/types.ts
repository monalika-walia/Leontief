/** Any signer works: Freighter / wallets-kit, a raw Keypair, a passkey signer —
 *  anything that can sign a transaction XDR for `address`. */
export type Signer = {
  address: string;
  sign: (txXdr: string) => Promise<string>;
};

export type LeontiefConfig = {
  rpcUrl: string;
  networkPassphrase: string;
  contracts: {
    vault: string;
    miniPool: string;
    oracleAdapter: string;
    /** SACs are optional — only needed for underlying/debt balance reads. */
    underlyingSac?: string;
    debtSac?: string;
  };
  /** Feed key in the oracle adapter, e.g. "LEOD" or "USDY". */
  assetId: string;
};

export type NavData = { nav: bigint; ts: bigint };
export type Position = { collateral_shares: bigint; debt: bigint };

/** Spec §3 scales. */
export const SCALE = 1_000_000_000_000n; // 10^12 — NAV / share_price scale
export const STROOP = 10_000_000n; // 10^7 — token amounts
/** Mini-pool risk params (compile-time constants in the deployed contract). */
export const POOL_PARAMS = {
  ltvBps: 8_000n,
  liqThresholdBps: 8_500n,
  liqBonusBps: 500n,
  bps: 10_000n,
} as const;
