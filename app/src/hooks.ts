import { useQuery } from "@tanstack/react-query";
import { useApp } from "./ctx";
import { addr, type Chain, type SimError, sym } from "./lib/chain";

// Protocol risk constants — compile-time constants in the deployed mini-pool
// (spec §6); the contract exposes no getter, so they are mirrored here 1:1.
export const POOL_PARAMS = { ltvBps: 8000, liqThresholdBps: 8500, liqBonusBps: 500 };

export type NavRead = { ok: true; nav: bigint; ts: bigint } | { ok: false; reason: string };

export function useNav() {
  const { env, chain } = useApp();
  return useQuery<NavRead>({
    queryKey: ["nav", env.LEOD_ASSET_ID],
    queryFn: async () => {
      try {
        const r = await chain.read<{ nav: bigint; ts: bigint }>(
          env.ORACLE_ADAPTER,
          "get_nav",
          sym(env.LEOD_ASSET_ID),
        );
        return { ok: true, nav: r.nav, ts: r.ts };
      } catch (e) {
        const se = e as SimError;
        const reason =
          se?.code === 6
            ? "Stale"
            : se?.code === 7
              ? "Deviation"
              : se?.code === 4
                ? "Unconfigured"
                : "Halted";
        return { ok: false, reason };
      }
    },
  });
}

export function useSharePrice() {
  const { env, chain } = useApp();
  return useQuery({
    queryKey: ["sharePrice", env.VAULT_LEOD],
    queryFn: () => chain.tryRead<bigint>(env.VAULT_LEOD, "share_price"),
  });
}

export function useTotalAssets() {
  const { env, chain } = useApp();
  return useQuery({
    queryKey: ["totalAssets", env.VAULT_LEOD],
    queryFn: () => chain.tryRead<bigint>(env.VAULT_LEOD, "total_assets_value"),
  });
}

export function useVaultTotals() {
  const { env, chain } = useApp();
  return useQuery({
    queryKey: ["vaultTotals", env.VAULT_LEOD],
    queryFn: async () => {
      const [totalShares, cap, paused] = await Promise.all([
        chain.tryRead<bigint>(env.VAULT_LEOD, "total_shares"),
        chain.tryRead<bigint>(env.VAULT_LEOD, "cap"),
        chain.tryRead<boolean>(env.VAULT_LEOD, "is_paused"),
      ]);
      return { totalShares, cap, paused };
    },
  });
}

export function useVaultBalance(user: string | null) {
  const { env, chain } = useApp();
  return useQuery({
    queryKey: ["vaultBalance", user],
    enabled: !!user,
    queryFn: () => chain.read<bigint>(env.VAULT_LEOD, "balance", addr(user!)),
  });
}

export function useTokenBalance(sac: string, user: string | null, key: string) {
  const { chain } = useApp();
  return useQuery({
    queryKey: ["tokenBalance", key, user],
    enabled: !!user,
    queryFn: () => chain.tryRead<bigint>(sac, "balance", addr(user!)),
  });
}

export type Position = { collateral_shares: bigint; debt: bigint };

export function usePosition(user: string | null) {
  const { env, chain } = useApp();
  return useQuery<Position>({
    queryKey: ["position", user],
    enabled: !!user,
    queryFn: () => chain.read<Position>(env.MINI_POOL, "position", addr(user!)),
  });
}

export function useHealthFactor(user: string | null) {
  const { env, chain } = useApp();
  return useQuery({
    queryKey: ["hf", user],
    enabled: !!user,
    queryFn: () => chain.tryRead<bigint>(env.MINI_POOL, "health_factor", addr(user!)),
  });
}

/** Convenience: the whole chain object, for one-off simulations in components. */
export function useChain(): Chain {
  return useApp().chain;
}
