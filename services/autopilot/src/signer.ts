// The session signer — the only code in this repo that signs on a user's behalf.
//
// DECISIONS #11 (Path B): the on-chain grant is a classic additional signer on the
// user's own account. That signer is NOT scope-limited on-chain, so:
//
//   * it exists only on testnet (asserted here, again, at construction time);
//   * every action it signs has already passed checkPolicy() and a pre-flight
//     simulation;
//   * the user can revoke it unilaterally with one set_options — after which
//     these signatures are simply rejected by the network, whatever this process
//     believes. That is the guarantee that does not depend on our good behaviour.
//
// Key material lives in the engine's own secret store (env), never in Postgres
// alongside the grant, and never anywhere the Telegram bot can reach.

import type { Signer } from "@leontief/sdk";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { TESTNET_PASSPHRASE } from "./config.js";
import type { GrantRow } from "./db.js";

/**
 * Build the session signer for a grant.
 *
 * `secrets` maps a user address → that user's session secret, loaded from the
 * engine's environment (AUTOPILOT_SESSION_<n> pairs) rather than the database.
 * Returns null when there is no session key, which is indistinguishable — by
 * design — from a revoked grant: no key, no capability, no action.
 */
export function sessionSignerFactory(
  secrets: Map<string, string>,
  networkPassphrase: string,
): (grant: GrantRow) => Signer | null {
  if (networkPassphrase !== TESTNET_PASSPHRASE) {
    throw new Error("session signers are TESTNET-only — refusing to construct one");
  }
  return (grant) => {
    if (grant.revoked) return null;
    const secret = secrets.get(grant.user);
    if (!secret) return null;

    const kp = Keypair.fromSecret(secret);
    // The session key signs FOR the user's account: the transaction source is
    // the user, and this key is an additional signer on it.
    return {
      address: grant.user,
      sign: async (xdr: string) => {
        const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
        tx.sign(kp);
        return tx.toXDR();
      },
    };
  };
}

/** Parse AUTOPILOT_SESSION_KEYS="G...:S...,G...:S..." into a map. */
export function parseSessionKeys(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const pair of raw.split(",")) {
    const [address, secret] = pair.split(":").map((s) => s.trim());
    if (address && secret) map.set(address, secret);
  }
  return map;
}
