// The alert engine: chain + indexer → decisions (alertLogic.ts) → Telegram.
//
// Three sources, all read-only:
//   1. health factor per followed address, with hysteresis and rate limiting;
//   2. oracle state changes (HALTED / recovered), broadcast to verified users;
//   3. an optional daily digest — "your position earned while you slept", which
//      is the entire thesis delivered as a notification.
import type { Bot } from "grammy";
import { decide, nextBand } from "./alertLogic.js";
import type { ReadOnlyChain } from "./chain.js";
import type { Config } from "./config.js";
import { allLinks, lastBand, lastSentAt, logAlert, prefsFor, sql, verifiedChats } from "./db.js";
import { amt, hfNumber, scaled, shortAddr } from "./format.js";

/** Send + record. A failed send (user blocked the bot) must not kill the loop. */
async function deliver(
  bot: Bot,
  chatId: number,
  body: string,
  meta: { kind: string; address?: string; band?: string },
): Promise<void> {
  try {
    await bot.api.sendMessage(chatId, body, { link_preview_options: { is_disabled: true } });
    await logAlert({ chatId, body, ...meta });
  } catch (e) {
    console.error(`alert: send to ${chatId} failed`, e);
  }
}

export async function runHealthAlerts(
  bot: Bot,
  chain: ReadOnlyChain,
  config: Config,
): Promise<number> {
  const links = await allLinks();
  // One chain read per distinct address, however many chats follow it.
  const addresses = [...new Set(links.map((l) => l.address))];
  const hfByAddress = new Map<string, number | null>();
  for (const address of addresses) {
    try {
      hfByAddress.set(address, hfNumber(await chain.healthFactor(address)));
    } catch {
      hfByAddress.set(address, null); // unreadable (halted oracle) — say nothing
    }
  }

  let sent = 0;
  for (const link of links) {
    const hf = hfByAddress.get(link.address);
    if (hf === null || hf === undefined || hf === Number.POSITIVE_INFINITY) continue;

    const prefs = await prefsFor(link.chat_id);
    const prev = await lastBand(link.chat_id, link.address);
    const band = nextBand(hf, prev, { warn: prefs.hf_warn, urgent: prefs.hf_urgent });
    const decision = decide({
      prev,
      next: band,
      paused: prefs.paused,
      lastSentAtMs: await lastSentAt(link.chat_id),
      nowMs: Date.now(),
    });
    if (!decision.send) continue;

    const head = decision.recovered
      ? `Recovered — ${shortAddr(link.address)} is back above your warning level.`
      : band === "urgent"
        ? `URGENT — ${shortAddr(link.address)} is close to liquidation.`
        : `Heads up — ${shortAddr(link.address)} has fallen below your warning level.`;
    const body = [
      head,
      `Health factor ${hf.toFixed(3)} (warn ${prefs.hf_warn} · urgent ${prefs.hf_urgent}).`,
      "Below 1.0 a whitelisted liquidator may act.",
      "",
      "Repay to restore it:",
      `${config.APP_BASE_URL}/intent?action=repay`,
      "You review and sign in your own wallet — this bot cannot act for you.",
    ].join("\n");

    await deliver(bot, link.chat_id, body, { kind: "hf", address: link.address, band });
    sent++;
  }
  return sent;
}

/** Oracle halts are protocol-wide news: broadcast once per state change. */
export async function runOracleAlerts(
  bot: Bot,
  chain: ReadOnlyChain,
  config: Config,
): Promise<number> {
  const nav = await chain.nav();
  const state = nav.ok ? "live" : `halted:${nav.reason}`;
  const [last] = await sql<{ band: string }[]>`
    SELECT band FROM alert_log WHERE kind = 'oracle' ORDER BY sent_at DESC LIMIT 1`;
  if (last?.band === state) return 0;

  const body = nav.ok
    ? [
        `${config.ASSET_ID} oracle is live again — NAV ${scaled(nav.nav, 6)}.`,
        "Deposits and borrows are available.",
      ].join("\n")
    : [
        `${config.ASSET_ID} oracle HALTED (${nav.reason}).`,
        "",
        "Leontief is fail-closed: rather than serve a stale or deviating price, the",
        "adapter reverts and everything priced off it stops. Deposits and borrows are",
        "unavailable until it recovers.",
        "Withdrawals and repayments are never blocked by this.",
      ].join("\n");

  const chats = await verifiedChats();
  for (const chatId of chats) await deliver(bot, chatId, body, { kind: "oracle", band: state });
  // Record the state even with zero subscribers, so the first user to link
  // doesn't get paged about a halt that started days ago.
  if (chats.length === 0) await logAlert({ chatId: 0, kind: "oracle", band: state, body });
  return chats.length;
}

/** "Your position earned while you slept." Once per 24h, opt-in. */
export async function runDailyDigest(
  bot: Bot,
  chain: ReadOnlyChain,
  config: Config,
): Promise<number> {
  const rows = await sql<{ chat_id: string }[]>`
    SELECT p.chat_id FROM alert_prefs p
    WHERE p.daily_digest = true AND p.paused = false
      AND NOT EXISTS (
        SELECT 1 FROM alert_log a
        WHERE a.chat_id = p.chat_id AND a.kind = 'digest' AND a.sent_at > now() - interval '20 hours'
      )`;
  if (rows.length === 0) return 0;

  const price = await chain.sharePrice().catch(() => undefined);
  const before = await sharePriceDayAgo(config.INDEXER_URL, config.VAULT);
  const links = await allLinks();

  let sent = 0;
  for (const row of rows) {
    const chatId = Number(row.chat_id);
    const mine = links.filter((l) => l.chat_id === chatId);
    if (mine.length === 0 || price === undefined) continue;

    let shares = 0n;
    for (const l of mine) {
      const [free, pos] = await Promise.all([
        chain.ldBalance(l.address).catch(() => 0n),
        chain.position(l.address).catch(() => ({ collateral_shares: 0n, debt: 0n })),
      ]);
      shares += free + pos.collateral_shares;
    }
    const value = (shares * price) / 1_000_000_000_000n;
    const delta = before !== null ? (shares * (price - before)) / 1_000_000_000_000n : null;
    const body = [
      "Overnight",
      `  share price ${scaled(price, 6)}${before !== null ? ` (was ${scaled(before, 6)})` : ""}`,
      `  your ${amt(shares)} ld${config.ASSET_ID} are worth ${amt(value)} USDC`,
      delta !== null ? `  earned while you slept: ${amt(delta)} USDC` : "",
      "",
      `${config.APP_BASE_URL}/positions`,
    ]
      .filter(Boolean)
      .join("\n");
    await deliver(bot, chatId, body, { kind: "digest" });
    sent++;
  }
  return sent;
}

async function sharePriceDayAgo(indexerUrl: string, vault: string): Promise<bigint | null> {
  try {
    const res = await fetch(`${indexerUrl}/vaults/${vault}/history`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { series?: { ts: string; share_price: string }[] };
    const cutoff = Date.now() - 24 * 3600_000;
    const older = (body.series ?? []).filter((p) => Date.parse(p.ts) <= cutoff);
    const point = older.at(-1) ?? body.series?.[0];
    return point ? BigInt(point.share_price) : null;
  } catch {
    return null;
  }
}

export async function runAlertCycle(bot: Bot, chain: ReadOnlyChain, config: Config): Promise<void> {
  for (const [name, fn] of [
    ["oracle", runOracleAlerts],
    ["health", runHealthAlerts],
    ["digest", runDailyDigest],
  ] as const) {
    try {
      const n = await fn(bot, chain, config);
      if (n > 0) console.log(`alerts: ${name} → ${n} message(s)`);
    } catch (e) {
      console.error(`alerts: ${name} cycle failed`, e);
    }
  }
}
