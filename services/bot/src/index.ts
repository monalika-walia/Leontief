// Webhook server + alert loop, one process (same shape as the indexer).
//
// Webhook mode, not long polling: Telegram POSTs here, and grammY rejects any
// request whose X-Telegram-Bot-Api-Secret-Token doesn't match WEBHOOK_SECRET.
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { Bot, webhookCallback } from "grammy";
import { runAlertCycle } from "./alerts.js";
import { ReadOnlyChain } from "./chain.js";
import { buildCommands } from "./commands.js";
import { loadConfig } from "./config.js";
import { assertSchema, sql } from "./db.js";

async function main() {
  const config = loadConfig();
  await assertSchema();

  const chain = new ReadOnlyChain(config);
  const bot = new Bot(config.BOT_TOKEN);
  bot.use(buildCommands(chain, config));
  bot.catch((err) => console.error("bot error", err.error));

  // Publish the command list so Telegram's UI offers them.
  await bot.api.setMyCommands([
    { command: "start", description: "what this bot does, and what it can't" },
    { command: "watch", description: "follow an address, read-only" },
    { command: "link", description: "prove an address is yours" },
    { command: "positions", description: "balances and pool position" },
    { command: "health", description: "health factor and risk band" },
    { command: "price", description: "NAV and freshness" },
    { command: "stats", description: "protocol totals" },
    { command: "alerts", description: "alert thresholds and digest" },
    { command: "borrow", description: "quote a borrow + link to sign in the app" },
    { command: "repay", description: "quote a repay + link to sign in the app" },
  ]);
  await bot.init();

  const app = Fastify({ logger: true, trustProxy: true });
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });

  app.get("/health", async () => {
    await sql`SELECT 1`;
    return { ok: true, bot: bot.botInfo.username };
  });

  app.post("/webhook", webhookCallback(bot, "fastify", { secretToken: config.WEBHOOK_SECRET }));

  await app.listen({ port: config.BOT_PORT, host: "0.0.0.0" });
  console.log(`bot @${bot.botInfo.username} listening on :${config.BOT_PORT}/webhook`);

  for (;;) {
    await runAlertCycle(bot, chain, config);
    await new Promise((r) => setTimeout(r, config.ALERT_POLL_SECS * 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
