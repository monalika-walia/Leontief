// One-shot: point Telegram at this deployment and set the shared secret.
//   PUBLIC_URL=https://bot.leontief.tech pnpm --filter @leontief/bot set-webhook
import { Bot } from "grammy";
import { loadConfig } from "./config.js";

const config = loadConfig();
if (!config.PUBLIC_URL) {
  console.error("set PUBLIC_URL to this service's public base URL first");
  process.exit(2);
}

const bot = new Bot(config.BOT_TOKEN);
const url = `${config.PUBLIC_URL.replace(/\/$/, "")}/webhook`;
await bot.api.setWebhook(url, {
  secret_token: config.WEBHOOK_SECRET,
  drop_pending_updates: true,
  allowed_updates: ["message", "callback_query"],
});
const info = await bot.api.getWebhookInfo();
console.log(`webhook → ${info.url}\npending: ${info.pending_update_count}`);
