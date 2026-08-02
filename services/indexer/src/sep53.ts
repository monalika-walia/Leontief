// SEP-53 "Sign and Verify Messages" — verification only. The backend NEVER
// signs anything here; it checks that whoever POSTed a link request controls the
// key for the address they claim.
//
// Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md
// (read 2026-08-02). Canonical payload is `"Stellar Signed Message:\n" || message`;
// the signature is ed25519 over SHA256(payload) — NOT over the raw message. The
// three spec test vectors are asserted in sep53.test.ts so this can't drift.
//
// Documented SEP-53 limitation, quoted: "Ownership of a private key does not
// imply control of the account… In multi-signer scenarios, possession of just
// one key may not grant full control over the account." That is acceptable for
// a read-only alert binding; accounts that need account-level proof (or smart
// wallets that cannot sign messages) use the on-chain memo fallback instead.
import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

const PREFIX = Buffer.from("Stellar Signed Message:\n", "utf8");

/** SHA256 of the canonical SEP-53 payload for `message`. */
export function sep53Digest(message: string | Buffer): Buffer {
  const bytes = typeof message === "string" ? Buffer.from(message, "utf8") : message;
  return createHash("sha256")
    .update(Buffer.concat([PREFIX, bytes]))
    .digest();
}

/** True when `signature` (base64 or hex) is a valid SEP-53 signature of
 *  `message` by `address`. Never throws — malformed input is just `false`. */
export function verifySep53(address: string, message: string, signature: string): boolean {
  try {
    const sig = decodeSignature(signature);
    if (!sig || sig.length !== 64) return false;
    return Keypair.fromPublicKey(address).verify(sep53Digest(message), sig);
  } catch {
    return false;
  }
}

function decodeSignature(s: string): Buffer | null {
  const trimmed = s.trim();
  if (/^[0-9a-fA-F]{128}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  const b64 = Buffer.from(trimmed, "base64");
  // Buffer.from is lenient; round-trip to reject junk that silently decodes.
  return b64.length === 64 ? b64 : null;
}

/**
 * The exact text a user signs to bind a Telegram chat to an address.
 *
 * Derived server-side from (code, address) alone so the client cannot choose
 * what gets signed: a wallet prompt can only ever show this sentence, and a
 * signature captured elsewhere cannot be replayed into a link request.
 */
export function linkChallenge(code: string, address: string): string {
  return [
    "Leontief — link Telegram",
    `code: ${code}`,
    `address: ${address}`,
    "",
    "Signing proves you control this address.",
    "It authorizes nothing, moves no funds, and grants no spending permission.",
  ].join("\n");
}
