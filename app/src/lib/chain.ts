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
import type { Env } from "./env";

// A strkey-valid but empty account used only as the source for read-only
// simulations (reads never submit, so it need not exist / be funded).
const READ_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export type ArgKind =
  | { addr: string }
  | { i128: bigint }
  | { sym: string }
  | { u32: number }
  | { bool: boolean };

function toScVal(a: ArgKind): xdr.ScVal {
  if ("addr" in a) return Address.fromString(a.addr).toScVal();
  if ("i128" in a) return nativeToScVal(a.i128, { type: "i128" });
  if ("sym" in a) return nativeToScVal(a.sym, { type: "symbol" });
  if ("u32" in a) return nativeToScVal(a.u32, { type: "u32" });
  return nativeToScVal(a.bool, { type: "bool" });
}

export class Chain {
  readonly server: rpc.Server;
  constructor(readonly env: Env) {
    this.server = new rpc.Server(env.RPC_URL, { allowHttp: env.RPC_URL.startsWith("http://") });
  }

  private buildRead(contractId: string, method: string, args: ArgKind[]) {
    const src = new Account(READ_SOURCE, "0");
    const contract = new Contract(contractId);
    return new TransactionBuilder(src, {
      fee: BASE_FEE,
      networkPassphrase: this.env.NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args.map(toScVal)))
      .setTimeout(30)
      .build();
  }

  /** Simulate a read and return its native value. Throws SimError on contract error. */
  async read<T = unknown>(contractId: string, method: string, ...args: ArgKind[]): Promise<T> {
    const sim = await this.server.simulateTransaction(this.buildRead(contractId, method, args));
    if (rpc.Api.isSimulationError(sim)) {
      throw new SimError(sim.error, contractId, method);
    }
    const retval = sim.result?.retval;
    if (!retval) throw new SimError("no return value", contractId, method);
    return scValToNative(retval) as T;
  }

  /** Like read, but returns undefined instead of throwing (for optional/None reads). */
  async tryRead<T = unknown>(
    contractId: string,
    method: string,
    ...args: ArgKind[]
  ): Promise<T | undefined> {
    try {
      return await this.read<T>(contractId, method, ...args);
    } catch {
      return undefined;
    }
  }

  explorerTx(hash: string): string {
    return `${this.env.EXPLORER_BASE}/tx/${hash}`;
  }
  explorerContract(id: string): string {
    return `${this.env.EXPLORER_BASE}/contract/${id}`;
  }
}

/** Simulation/contract error carrying the extracted `Error(Contract, #N)` code. */
export class SimError extends Error {
  readonly code: number | null;
  constructor(
    readonly raw: string,
    readonly contractId: string,
    readonly method: string,
  ) {
    super(raw);
    this.name = "SimError";
    const m = raw.match(/Error\(Contract,\s*#(\d+)\)/);
    this.code = m ? Number(m[1]) : null;
  }
}

// arg constructors (ergonomic)
export const addr = (a: string): ArgKind => ({ addr: a });
export const i128 = (v: bigint): ArgKind => ({ i128: v });
export const sym = (s: string): ArgKind => ({ sym: s });
export const u32 = (n: number): ArgKind => ({ u32: n });
export const bool = (b: boolean): ArgKind => ({ bool: b });
