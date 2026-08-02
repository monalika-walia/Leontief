import { z } from "zod";

// Fail fast and loudly: a bot that starts with half its config answers users
// with stack traces. Note what is NOT here — there is no key, seed, or signer
// setting, and adding one would be a review failure (see CI's no-signing gate).
const schema = z.object({
  BOT_TOKEN: z.string().min(20),
  /** Compared against X-Telegram-Bot-Api-Secret-Token on every webhook POST. */
  WEBHOOK_SECRET: z.string().min(16),
  /** Public base URL of THIS service, used to register the webhook. */
  PUBLIC_URL: z.string().url().optional(),
  APP_BASE_URL: z.string().url().default("https://app.leontief.tech"),
  INDEXER_URL: z.string().url().default("http://localhost:8788"),
  DATABASE_URL: z.string().min(1),
  RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org"),
  NETWORK_PASSPHRASE: z.string().default("Test SDF Network ; September 2015"),
  EXPLORER_BASE: z.string().url().default("https://stellar.expert/explorer/testnet"),
  VAULT: z.string().min(56),
  MINI_POOL: z.string().min(56),
  ORACLE_ADAPTER: z.string().min(56),
  USDC_SAC: z.string().min(56),
  LEOD_SAC: z.string().min(56),
  ASSET_ID: z.string().default("LEOD"),
  BOT_PORT: z.coerce.number().default(8789),
  ALERT_POLL_SECS: z.coerce.number().default(60),
  /** Published on the site footer so users can tell a fake bot from this one. */
  BOT_HANDLE: z.string().default("@LeontiefProtocolBot"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    console.error(`bot: invalid configuration\n${missing.join("\n")}`);
    process.exit(2);
  }
  return parsed.data;
}
