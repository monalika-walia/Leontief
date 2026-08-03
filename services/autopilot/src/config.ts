import { z } from "zod";

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

// Autopilot is OFF unless explicitly switched on, and refuses to exist outside
// testnet. Both are load-bearing, not hygiene: this service is the only thing in
// the repo that signs on a user's behalf.
const schema = z.object({
  /** Master flag. Production builds exclude the engine unless this is "true". */
  AUTOPILOT_FLAG: z.string().default("false"),
  /** Second switch, for stopping a running fleet without a redeploy. */
  AUTOPILOT_KILL: z.string().default("false"),
  DATABASE_URL: z.string().min(1),
  RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org"),
  NETWORK_PASSPHRASE: z.string().default(TESTNET_PASSPHRASE),
  EXPLORER_BASE: z.string().url().default("https://stellar.expert/explorer/testnet"),
  VAULT: z.string().min(56),
  MINI_POOL: z.string().min(56),
  ORACLE_ADAPTER: z.string().min(56),
  USDC_SAC: z.string().min(56),
  LEOD_SAC: z.string().min(56),
  ASSET_ID: z.string().default("LEOD"),
  /** Telegram bot token, only to notify users about actions taken for them. */
  BOT_TOKEN: z.string().optional(),
  APP_BASE_URL: z.string().url().default("https://app.leontief.tech"),
  LOOP_SECS: z.coerce.number().default(120),
  COOLDOWN_SECS: z.coerce.number().default(300),
  /** Hard bound on actions per cycle across all users — no runaway automation. */
  MAX_ACTIONS_PER_CYCLE: z.coerce.number().default(5),
});

export type Config = z.infer<typeof schema> & { enabled: boolean; killed: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    console.error(
      `autopilot: invalid configuration\n${parsed.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
    process.exit(2);
  }
  const cfg = parsed.data;

  if (cfg.NETWORK_PASSPHRASE !== TESTNET_PASSPHRASE) {
    console.error(
      "autopilot: refusing to run outside testnet.\n" +
        "Mainnet Autopilot requires an audit and human sign-off — see DECISIONS #12.",
    );
    process.exit(2);
  }
  return {
    ...cfg,
    enabled: cfg.AUTOPILOT_FLAG === "true",
    killed: cfg.AUTOPILOT_KILL === "true",
  };
}
