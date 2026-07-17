import {
  Address,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import { type ArgKind, type Chain, SimError } from "./chain";

/** A signer takes an unsigned tx XDR and returns a signed tx XDR. */
export type Signer = {
  address: string;
  sign: (xdr: string) => Promise<string>;
};

function toScVal(a: ArgKind): xdr.ScVal {
  if ("addr" in a) return Address.fromString(a.addr).toScVal();
  if ("i128" in a) return nativeToScVal(a.i128, { type: "i128" });
  if ("sym" in a) return nativeToScVal(a.sym, { type: "symbol" });
  if ("u32" in a) return nativeToScVal(a.u32, { type: "u32" });
  return nativeToScVal(a.bool, { type: "bool" });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type TxResult = { hash: string; returnValue: unknown };

/**
 * The one shared write path: build → simulate (map errors, stop early) →
 * assemble with resource fees → sign → send → poll to SUCCESS/FAILED. Times out
 * after ~60s, never silent.
 */
export async function submitTx(
  chain: Chain,
  signer: Signer,
  contractId: string,
  method: string,
  args: ArgKind[] = [],
): Promise<TxResult> {
  const account = await chain.server.getAccount(signer.address);
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: chain.env.NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args.map(toScVal)))
    .setTimeout(60)
    .build();

  const sim = await chain.server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new SimError(sim.error, contractId, method);
  }
  const prepared = rpc.assembleTransaction(tx, sim).build();

  const signedXdr = await signer.sign(prepared.toXDR());
  const signedTx = TransactionBuilder.fromXDR(signedXdr, chain.env.NETWORK_PASSPHRASE);

  const sent = await chain.server.sendTransaction(signedTx);
  if (sent.status === "ERROR") {
    throw new SimError(JSON.stringify(sent.errorResult ?? sent), contractId, method);
  }

  const deadline = Date.now() + 60_000;
  let got = await chain.server.getTransaction(sent.hash);
  while (got.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() > deadline) throw new Error(`Transaction ${sent.hash} still pending after 60s`);
    await sleep(1500);
    got = await chain.server.getTransaction(sent.hash);
  }
  if (got.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new SimError(`transaction failed: ${got.status}`, contractId, method);
  }
  const returnValue = got.returnValue ? scValToNative(got.returnValue) : undefined;
  return { hash: sent.hash, returnValue };
}
