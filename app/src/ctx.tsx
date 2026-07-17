import {
  allowAllModules,
  FREIGHTER_ID,
  StellarWalletsKit,
  WalletNetwork,
} from "@creit.tech/stellar-wallets-kit";
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
};

type Ctx = { env: Env; chain: Chain; wallet: Wallet };

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ env, children }: { env: Env; children: ReactNode }) {
  const chain = useMemo(() => new Chain(env), [env]);
  const kit = useMemo(
    () =>
      new StellarWalletsKit({
        network: WalletNetwork.TESTNET,
        selectedWalletId: FREIGHTER_ID,
        modules: allowAllModules(),
      }),
    [],
  );
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const wallet: Wallet = useMemo(() => {
    const signer: Signer | null = address
      ? {
          address,
          sign: async (xdr: string) => {
            const { signedTxXdr } = await kit.signTransaction(xdr, {
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
      connect: async () => {
        setConnecting(true);
        try {
          await kit.openModal({
            onWalletSelected: async (opt) => {
              kit.setWallet(opt.id);
              const { address: a } = await kit.getAddress();
              setAddress(a);
            },
          });
        } finally {
          setConnecting(false);
        }
      },
      disconnect: () => setAddress(null),
    };
  }, [address, connecting, kit, env.NETWORK_PASSPHRASE]);

  return <AppCtx.Provider value={{ env, chain, wallet }}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}
