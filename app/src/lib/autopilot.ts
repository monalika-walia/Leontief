import {
  BASE_FEE,
  Keypair,
  Operation,
  type rpc,
  type Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { Signer } from "./submitTx";

/**
 * The Autopilot grant ceremony (A8 Tier 2, Path B — DECISIONS #11).
 *
 * A session keypair is added as an **additional signer on the user's own
 * account**, and the account's thresholds are set so that key can act but cannot
 * escalate:
 *
 *   master weight   2   — the user keeps full control
 *   low  / medium   1   — the session key can invoke contracts
 *   high            2   — the session key can NOT add/remove signers or change
 *                         thresholds, so it can never lock the user out
 *
 * Being honest about what this is: a classic Stellar signer is **not
 * scope-limited**. Within the medium threshold it can sign anything the account
 * can do, including ordinary payments. The on-chain layer contributes exactly
 * one guarantee — the user can revoke it unilaterally and instantly — and the
 * engine-side policy is the real leash. The UI says this in as many words.
 */
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export type SessionKey = { publicKey: string; secret: string };

/** Generate the session keypair in the browser. The secret goes to the engine
 *  operator out-of-band; it is never put in the app's own storage. */
export function generateSessionKey(): SessionKey {
  const kp = Keypair.random();
  return { publicKey: kp.publicKey(), secret: kp.secret() };
}

async function buildSigned(
  server: rpc.Server,
  passphrase: string,
  signer: Signer,
  build: (b: TransactionBuilder) => TransactionBuilder,
): Promise<string> {
  if (passphrase !== TESTNET_PASSPHRASE) {
    throw new Error("Autopilot is testnet-only — refusing to build this grant");
  }
  const account = await server.getAccount(signer.address);
  const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase });
  const tx = build(builder).setTimeout(120).build();
  const signedXdr = await signer.sign(tx.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, passphrase) as Transaction;
  const sent = await server.sendTransaction(signed);
  if (sent.status === "ERROR") {
    throw new Error(`grant transaction rejected: ${JSON.stringify(sent.errorResult ?? sent)}`);
  }
  return sent.hash;
}

/** Add the session key as a weight-1 signer and raise the high threshold. */
export function grantSessionSigner(
  server: rpc.Server,
  passphrase: string,
  signer: Signer,
  sessionPublicKey: string,
): Promise<string> {
  return buildSigned(server, passphrase, signer, (b) =>
    b
      .addOperation(
        Operation.setOptions({
          masterWeight: 2,
          lowThreshold: 1,
          medThreshold: 1,
          highThreshold: 2,
        }),
      )
      .addOperation(
        Operation.setOptions({
          signer: { ed25519PublicKey: sessionPublicKey, weight: 1 },
        }),
      ),
  );
}

/** Revoke: weight 0 removes the signer outright. One transaction, one tap, and
 *  the engine's capability is gone regardless of what the engine believes. */
export function revokeSessionSigner(
  server: rpc.Server,
  passphrase: string,
  signer: Signer,
  sessionPublicKey: string,
): Promise<string> {
  return buildSigned(server, passphrase, signer, (b) =>
    b.addOperation(
      Operation.setOptions({ signer: { ed25519PublicKey: sessionPublicKey, weight: 0 } }),
    ),
  );
}

export type Limits = {
  strategy: "digest-only" | "hf-guard" | "idle-sweep";
  perActionCap: string;
  dailyCap: string;
  expiryDays: number;
};

/** Plain-language description of exactly what the agent can and cannot do. */
export function describeLimits(l: Limits): { can: string[]; cannot: string[] } {
  const can =
    l.strategy === "digest-only"
      ? ["Read your position and report on it. Nothing else."]
      : l.strategy === "hf-guard"
        ? [
            `Repay your loan from your idle USDC when your health factor slips — at most ${l.perActionCap} USDC per action and ${l.dailyCap} USDC per day.`,
            "Only on your vault and the Leontief mini-pool.",
          ]
        : [
            `Wrap mirror-asset you already hold into ld-shares — at most ${l.perActionCap} per action and ${l.dailyCap} per day.`,
            "Only on your vault and the Leontief mini-pool.",
          ];
  return {
    can,
    cannot: [
      "Take your health factor below 1.6 — every action is simulated first and refused if it would.",
      "Borrow, withdraw your collateral, or sell your position.",
      "Act after " + l.expiryDays + " days, or after you press Disable.",
      "Change your account's signers or thresholds — it does not have the weight.",
    ],
  };
}
