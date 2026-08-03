// Autopilot runner. Off by default; testnet only; bounded per cycle.
import { LeontiefClient } from "@leontief/sdk";
import { loadConfig } from "./config.js";
import { migrate, sql } from "./db.js";
import { runCycle } from "./engine.js";
import { parseSessionKeys, sessionSignerFactory } from "./signer.js";

async function notifyTelegram(token: string | undefined, chatId: number | null, text: string) {
  if (!token || chatId === null) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error("autopilot: telegram notify failed", e);
  }
}

async function main() {
  const config = loadConfig();
  if (!config.enabled) {
    console.log(
      "autopilot: AUTOPILOT_FLAG is not 'true' — engine disabled, exiting.\n" +
        "This is the default. Autopilot is never on unless someone turns it on.",
    );
    await sql.end();
    return;
  }
  await migrate();

  const client = new LeontiefClient({
    rpcUrl: config.RPC_URL,
    networkPassphrase: config.NETWORK_PASSPHRASE,
    contracts: {
      vault: config.VAULT,
      miniPool: config.MINI_POOL,
      oracleAdapter: config.ORACLE_ADAPTER,
      underlyingSac: config.LEOD_SAC,
      debtSac: config.USDC_SAC,
    },
    assetId: config.ASSET_ID,
  });

  const signerFor = sessionSignerFactory(
    parseSessionKeys(process.env.AUTOPILOT_SESSION_KEYS),
    config.NETWORK_PASSPHRASE,
  );

  console.log(
    `autopilot: engine up (testnet), max ${config.MAX_ACTIONS_PER_CYCLE} actions/cycle, ` +
      `${config.COOLDOWN_SECS}s per-user cooldown`,
  );
  for (;;) {
    try {
      const n = await runCycle(client, config, signerFor, (chatId, text) =>
        notifyTelegram(config.BOT_TOKEN, chatId, text),
      );
      if (n > 0) console.log(`autopilot: ${n} action(s) executed`);
    } catch (e) {
      console.error("autopilot: cycle failed", e);
    }
    await new Promise((r) => setTimeout(r, config.LOOP_SECS * 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
