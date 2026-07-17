import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import type { Signer } from "./types.js";

/** Strkey-valid, unfunded account used only as the source of read simulations. */
const READ_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export type Arg =
  | { addr: string }
  | { i128: bigint }
  | { sym: string }
  | { u32: number }
  | { bool: boolean };

export function toScVal(a: Arg): xdr.ScVal {
  if ("addr" in a) return Address.fromString(a.addr).toScVal();
  if ("i128" in a) return nativeToScVal(a.i128, { type: "i128" });
  if ("sym" in a) return nativeToScVal(a.sym, { type: "symbol" });
  if ("u32" in a) return nativeToScVal(a.u32, { type: "u32" });
  return nativeToScVal(a.bool, { type: "bool" });
}

/** Contract error with the `Error(Contract, #N)` code extracted. */
export class ContractError extends Error {
  readonly code: number | null;
  constructor(
    readonly raw: string,
    readonly contractId: string,
    readonly method: string,
  ) {
    super(raw);
    this.name = "ContractError";
    this.code = extractCode(raw);
  }
}

export function extractCode(raw: string): number | null {
  const m = raw.match(/Error\(Contract,\s*#(\d+)\)/);
  return m ? Number(m[1]) : null;
}

export async function simulateRead<T>(
  server: rpc.Server,
  passphrase: string,
  contractId: string,
  method: string,
  args: Arg[],
): Promise<T> {
  const tx = new TransactionBuilder(new Account(READ_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args.map(toScVal)))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new ContractError(sim.error, contractId, method);
  if (!sim.result?.retval) throw new ContractError("no return value", contractId, method);
  return scValToNative(sim.result.retval) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** build → simulate (typed error, stop early) → assemble fees → sign → send →
 *  poll to SUCCESS/FAILED. 60s timeout, never silent. */
export async function submit(
  server: rpc.Server,
  passphrase: string,
  signer: Signer,
  contractId: string,
  method: string,
  args: Arg[],
): Promise<{ hash: string; returnValue: unknown }> {
  const account = await server.getAccount(signer.address);
  const tx = new TransactionBuilder(account, { fee: "1000000", networkPassphrase: passphrase })
    .addOperation(new Contract(contractId).call(method, ...args.map(toScVal)))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new ContractError(sim.error, contractId, method);
  const prepared = rpc.assembleTransaction(tx, sim).build();

  const signed = TransactionBuilder.fromXDR(await signer.sign(prepared.toXDR()), passphrase);
  const sent = await server.sendTransaction(signed);
  if (sent.status === "ERROR") {
    throw new ContractError(JSON.stringify(sent.errorResult ?? sent), contractId, method);
  }

  const deadline = Date.now() + 60_000;
  let got = await server.getTransaction(sent.hash);
  while (got.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() > deadline) throw new Error(`transaction ${sent.hash} still pending after 60s`);
    await sleep(1500);
    got = await server.getTransaction(sent.hash);
  }
  if (got.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new ContractError(`transaction failed: ${got.status}`, contractId, method);
  }
  return {
    hash: sent.hash,
    returnValue: got.returnValue ? scValToNative(got.returnValue) : undefined,
  };
}
