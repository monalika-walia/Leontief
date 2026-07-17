import { useQueryClient } from "@tanstack/react-query";
import { useToasts } from "../components/TxToast";
import { useApp } from "../ctx";
import type { ArgKind } from "./chain";
import { type ContractKind, humanError } from "./errors";
import { logTx } from "./sessionLog";
import { type Signer, submitTx } from "./submitTx";

/**
 * The single UI entry point for writes. Handles: no-wallet guard, busy state,
 * error-copy mapping, explorer toast, and query invalidation. Pass an explicit
 * `signer` (demo mode) to override the connected wallet.
 */
export function useSubmit() {
  const { chain, wallet } = useApp();
  const { push, setBusy } = useToasts();
  const qc = useQueryClient();

  return async function submit(opts: {
    kind: ContractKind;
    contractId: string;
    method: string;
    args?: ArgKind[];
    label: string;
    invalidate?: string[];
    signer?: Signer;
  }): Promise<string | null> {
    const signer = opts.signer ?? wallet.signer;
    if (!signer) {
      push({ kind: "info", msg: "Connect a wallet to sign this action." });
      return null;
    }
    setBusy(true);
    try {
      const { hash } = await submitTx(chain, signer, opts.contractId, opts.method, opts.args ?? []);
      push({
        kind: "ok",
        msg: `${opts.label} confirmed.`,
        href: chain.explorerTx(hash),
        hrefLabel: "view tx ↗",
      });
      logTx({ type: opts.label, hash });
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: [k] });
      return hash;
    } catch (e) {
      push({ kind: "err", msg: humanError(opts.kind, e) });
      return null;
    } finally {
      setBusy(false);
    }
  };
}
