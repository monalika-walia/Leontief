import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Env } from "./env";
import type { Signer } from "./submitTx";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export type DemoRole = "issuer" | "admin" | "user" | "liquidator" | "rando";

/**
 * Demo signers built from throwaway TESTNET secret keys emitted by
 * setup_testnet.sh. Guardrails, enforced in code (not convention):
 *  - throws unless the network is testnet;
 *  - only reachable when env.DEMO is true.
 * Production builds without the demo flag never import demo secret keys.
 */
export function demoSigner(env: Env, role: DemoRole): Signer {
  if (!env.DEMO) throw new Error("demo signer requested outside demo mode");
  if (env.NETWORK_PASSPHRASE !== TESTNET_PASSPHRASE) {
    throw new Error("demo keys are TESTNET-only — refusing to sign on this network");
  }
  const sk = {
    issuer: env.DEMO_ISSUER_SK,
    admin: env.DEMO_ADMIN_SK,
    user: env.DEMO_USER_SK,
    liquidator: env.DEMO_LIQUIDATOR_SK,
    rando: env.DEMO_RANDO_SK,
  }[role];
  if (!sk) throw new Error(`demo key for role "${role}" is not configured`);

  const kp = Keypair.fromSecret(sk);
  return {
    address: kp.publicKey(),
    sign: async (xdrStr: string) => {
      const tx = TransactionBuilder.fromXDR(xdrStr, env.NETWORK_PASSPHRASE);
      tx.sign(kp);
      return tx.toXDR();
    },
  };
}
