import { z } from "zod";

// Validate all VITE_ env at boot; a missing var shows a full-screen config error
// (never a blank app). Demo keys are only required when demo mode is on.
const schema = z.object({
  RPC_URL: z.string().url(),
  NETWORK_PASSPHRASE: z.string().min(1),
  EXPLORER_BASE: z.string().url(),
  VAULT_FACTORY: z.string().min(56),
  VAULT_LEOD: z.string().min(56),
  ORACLE_ADAPTER: z.string().min(56),
  MOCK_ORACLE: z.string().min(56),
  MINI_POOL: z.string().min(56),
  LEOD_SAC: z.string().min(56),
  USDC_SAC: z.string().min(56),
  LEOD_ASSET_ID: z.string().min(1).default("LEOD"),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  DEMO_ISSUER_SK: z.string().optional(),
  DEMO_ADMIN_SK: z.string().optional(),
  DEMO_USER_SK: z.string().optional(),
  DEMO_LIQUIDATOR_SK: z.string().optional(),
  DEMO_RANDO_SK: z.string().optional(),
});

export type Env = z.infer<typeof schema> & { DEMO: boolean };

function raw(): Record<string, string | undefined> {
  const e = import.meta.env;
  return {
    RPC_URL: e.VITE_RPC_URL,
    NETWORK_PASSPHRASE: e.VITE_NETWORK_PASSPHRASE,
    EXPLORER_BASE: e.VITE_EXPLORER_BASE,
    VAULT_FACTORY: e.VITE_VAULT_FACTORY,
    VAULT_LEOD: e.VITE_VAULT_LEOD,
    ORACLE_ADAPTER: e.VITE_ORACLE_ADAPTER,
    MOCK_ORACLE: e.VITE_MOCK_ORACLE,
    MINI_POOL: e.VITE_MINI_POOL,
    LEOD_SAC: e.VITE_LEOD_SAC,
    USDC_SAC: e.VITE_USDC_SAC,
    LEOD_ASSET_ID: e.VITE_LEOD_ASSET_ID,
    DEMO_MODE: e.VITE_DEMO_MODE,
    DEMO_ISSUER_SK: e.VITE_DEMO_ISSUER_SK,
    DEMO_ADMIN_SK: e.VITE_DEMO_ADMIN_SK,
    DEMO_USER_SK: e.VITE_DEMO_USER_SK,
    DEMO_LIQUIDATOR_SK: e.VITE_DEMO_LIQUIDATOR_SK,
    DEMO_RANDO_SK: e.VITE_DEMO_RANDO_SK,
  };
}

export type EnvResult = { ok: true; env: Env } | { ok: false; missing: string[] };

export function loadEnv(): EnvResult {
  const parsed = schema.safeParse(raw());
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `VITE_${i.path.join(".")}: ${i.message}`);
    return { ok: false, missing };
  }
  return { ok: true, env: { ...parsed.data, DEMO: parsed.data.DEMO_MODE === "true" } };
}
