import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Signer } from "./types.js";

/** Signer from a raw secret key — for bots, scripts, and the testnet examples.
 *  Browser wallets (Freighter/xBull via wallets-kit) implement the same
 *  interface with their own sign() — see the dApp's ctx.tsx. */
export function keypairSigner(secret: string, networkPassphrase: string): Signer {
  const kp = Keypair.fromSecret(secret);
  return {
    address: kp.publicKey(),
    sign: async (txXdr: string) => {
      const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase);
      tx.sign(kp);
      return tx.toXDR();
    },
  };
}
