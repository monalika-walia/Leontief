// Contract error code → human copy. Codes overlap across contracts (e.g. #6 is
// OracleFailure in the vault but StalePrice in the adapter), so the table is
// keyed by contract kind. Tone: calm ledger clerk, no exclamation marks.
import type { SimError } from "./chain";

export type ContractKind = "vault" | "adapter" | "pool" | "sac";

const VAULT: Record<number, string> = {
  1: "This vault is not initialized yet.",
  2: "Deposits are paused; withdrawals remain open — always.",
  3: "The vault cap is reached; less room remains than you asked to wrap.",
  4: "Enter an amount greater than zero.",
  5: "You are trying to redeem more shares than you hold.",
  6: "Price feed halted rather than guessing — funds are safe, this action is unavailable.",
  7: "Only the vault admin may do that.",
  8: "The vault is already initialized.",
  9: "The spender's allowance is insufficient.",
  10: "The amount is out of the range this ledger can represent.",
  11: "That amount is invalid.",
  12: "The approval expiration is in the past.",
};

const ADAPTER: Record<number, string> = {
  1: "The oracle adapter is not initialized.",
  2: "Only the adapter admin may do that.",
  3: "The adapter is already initialized.",
  4: "No price feed is configured for this asset.",
  5: "The price feed returned nothing usable — halted, not guessed.",
  6: "The price is stale; pricing is halted until a fresh value arrives.",
  7: "The price moved beyond the per-update bound; pricing is halted for review.",
  8: "The price could not be normalized within range.",
  9: "That feed configuration is invalid.",
};

const POOL: Record<number, string> = {
  1: "The pool is not initialized.",
  2: "Only the pool admin may do that.",
  3: "The pool is already initialized.",
  4: "Enter an amount greater than zero.",
  5: "You do not have that much collateral supplied.",
  6: "That borrow would exceed the loan-to-value limit.",
  7: "That withdrawal would push your health factor below 1.",
  8: "Liquidation of restricted collateral is whitelist-gated.",
  9: "This position is healthy and cannot be liquidated.",
  10: "A single liquidation may repay at most half the debt.",
  11: "Price feed halted rather than guessing — this action is unavailable.",
  12: "The amount is out of representable range.",
  13: "The pool does not have enough liquidity for that borrow.",
};

const TABLES: Record<ContractKind, Record<number, string>> = {
  vault: VAULT,
  adapter: ADAPTER,
  pool: POOL,
  sac: {},
};

export function humanError(kind: ContractKind, e: unknown): string {
  const se = e as SimError;
  if (se && typeof se === "object" && "code" in se && se.code != null) {
    const copy = TABLES[kind][se.code];
    if (copy) return copy;
    return `Unexpected contract error #${se.code} — please report this.`;
  }
  const msg = (e as Error)?.message ?? String(e);
  // Surface a SAC authorization failure legibly (beat 1).
  if (/NotAuthorized|not authorized/i.test(msg))
    return "This asset is transfer-restricted; the destination is not authorized to hold it.";
  return msg;
}
