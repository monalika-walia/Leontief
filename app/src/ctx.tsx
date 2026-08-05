import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { Networks } from "@creit.tech/stellar-wallets-kit/types";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { Chain } from "./lib/chain";
import type { Env } from "./lib/env";
import type { Signer } from "./lib/submitTx";

type Wallet = {
  address: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signer: Signer | null;
  /** SEP-53 message signature — used by the Telegram link ceremony (A8). */
  signMessage: ((message: string) => Promise<string>) | null;
};

type Ctx = { env: Env; chain: Chain; wallet: Wallet };

const AppCtx = createContext<Ctx | null>(null);

// Wallets-kit v2 is a static singleton — init once per page load, not per render.
let kitReady = false;
function initKit(passphrase: string) {
  if (kitReady) return;
  StellarWalletsKit.init({
    modules: defaultModules(),
    network: passphrase === Networks.PUBLIC ? Networks.PUBLIC : Networks.TESTNET,
  });
  kitReady = true;
}

export function AppProvider({ env, children }: { env: Env; children: ReactNode }) {
  const chain = useMemo(() => new Chain(env), [env]);
  initKit(env.NETWORK_PASSPHRASE);
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const wallet: Wallet = useMemo(() => {
    const signer: Signer | null = address
      ? {
          address,
          sign: async (xdr: string) => {
            const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
              address,
              networkPassphrase: env.NETWORK_PASSPHRASE,
            });
            return signedTxXdr;
          },
        }
      : null;
    return {
      address,
      connecting,
      signer,
      signMessage: address
        ? async (message: string) => {
            const { signedMessage } = await StellarWalletsKit.signMessage(message, {
              address,
              networkPassphrase: env.NETWORK_PASSPHRASE,
            });
            return signedMessage;
          }
        : null,
      connect: async () => {
        setConnecting(true);
        try {
          const { address: a } = await StellarWalletsKit.authModal();
          setAddress(a);
        } finally {
          setConnecting(false);
        }
      },
      disconnect: () => {
        void StellarWalletsKit.disconnect();
        setAddress(null);
      },
    };
  }, [address, connecting, env.NETWORK_PASSPHRASE]);

  return <AppCtx.Provider value={{ env, chain, wallet }}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}
