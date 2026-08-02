// Every command in the Leontief bot.
//
// The hard rule, visible in the code: the action commands (/wrap, /unwrap,
// /supply, /borrow, /repay) DO NOT execute anything. They quote the action from
// a live simulation and hand back a deep link into the dApp, where the user
// signs in their own wallet. Nothing in this file can produce a signature.
import { type CommandContext, Composer, type Context, InlineKeyboard } from "grammy";
import type { ReadOnlyChain } from "./chain.js";
import { fetchMetrics } from "./chain.js";
import type { Config } from "./config.js";
import { addWatch, linksFor, mintLinkCode, prefsFor, removeLink, updatePrefs } from "./db.js";
import { ageLabel, amt, hfLine, hfNumber, parseAmount, scaled, shortAddr } from "./format.js";
import { INTENT_FOOTER, type IntentAction, intentUrl } from "./intents.js";

const G_ADDRESS = /^G[A-Z2-7]{55}$/;

export const ANTI_PHISHING = [
  "Safety, once:",
  "• Leontief will never DM you first.",
  "• Leontief will never ask for your secret key or seed phrase — not here, not anywhere.",
  "• Leontief will never send you a 'validation' or 'sync' link off leontief.tech.",
  "This bot cannot move your funds. It can read public chain data and send you links.",
].join("\n");

export function buildCommands(chain: ReadOnlyChain, config: Config): Composer<Context> {
  const c = new Composer<Context>();
  const app = config.APP_BASE_URL;

  /** Addresses this chat follows; replies with guidance when there are none. */
  async function addressesOr(ctx: { chat?: { id: number } }): Promise<string[] | null> {
    const links = await linksFor(ctx.chat?.id ?? 0);
    return links.length ? links.map((l) => l.address) : null;
  }

  c.command("start", async (ctx) => {
    await ctx.reply(
      [
        "Leontief — the Awake Ledger, in your pocket.",
        "",
        "Wrapped RWAs keep earning while you sleep; this bot tells you when something",
        "needs your attention and hands you a link to act on it.",
        "",
        "  /watch G…    follow any address, read-only",
        "  /link        prove an address is yours (needed for alerts + prefs)",
        "  /positions   your balances and pool position",
        "  /health      health factor, with the app's SAFE / MODERATE / AT RISK bands",
        "  /price       NAV and how fresh it is",
        "  /stats       protocol totals",
        "  /alerts      alert thresholds and daily digest",
        "  /wrap /unwrap /supply /borrow /repay  — quote + a link to sign in the app",
        "",
        ANTI_PHISHING,
        "",
        `This bot's only handle is ${config.BOT_HANDLE}, published on leontief.tech.`,
      ].join("\n"),
      { link_preview_options: { is_disabled: true } },
    );
  });

  c.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Commands:",
        "/watch G… · /link · /unlink · /positions · /health · /price [ASSET] · /stats",
        "/alerts · /pause · /resume",
        "/wrap <amt> [ASSET] · /unwrap <amt> · /supply <amt> · /borrow <amt> · /repay <amt>",
        "",
        "Action commands never execute. They reply with a quote and a link you open,",
        "review, and sign yourself.",
      ].join("\n"),
    );
  });

  // ── Linking ────────────────────────────────────────────────────────────────

  c.command("watch", async (ctx) => {
    const arg = (ctx.match ?? "").toString().trim().toUpperCase();
    if (!G_ADDRESS.test(arg)) {
      await ctx.reply("Usage: /watch G… (a 56-character Stellar address)");
      return;
    }
    await addWatch(ctx.chat.id, arg);
    await ctx.reply(
      [
        `Watching ${shortAddr(arg)} — read-only, unverified.`,
        "You'll get position alerts at the default thresholds.",
        "Run /link to prove it's yours and unlock alert preferences.",
      ].join("\n"),
    );
  });

  c.command("link", async (ctx) => {
    const code = await mintLinkCode(ctx.chat.id);
    const url = `${app}/link?code=${code}`;
    await ctx.reply(
      [
        `Your one-time code: ${code}  (valid 15 minutes)`,
        "",
        `Open ${url} with your wallet connected.`,
        "The app will ask you to sign a short message containing this code.",
        "",
        "That signature proves you control the address. It authorizes nothing,",
        "moves no funds, and grants no spending permission — and this bot never",
        "sees your key.",
      ].join("\n"),
      { link_preview_options: { is_disabled: true } },
    );
  });

  c.command("unlink", async (ctx) => {
    const n = await removeLink(ctx.chat.id);
    await ctx.reply(n ? `Unlinked ${n} address(es). No more alerts.` : "Nothing was linked.");
  });

  // ── Reads ──────────────────────────────────────────────────────────────────

  c.command("positions", async (ctx) => {
    const addresses = await addressesOr(ctx);
    if (!addresses) return void ctx.reply("No address yet — /watch G… or /link.");
    const price = await chain.sharePrice().catch(() => undefined);
    const lines: string[] = [];
    for (const address of addresses) {
      const [ld, pos, usdc, leod] = await Promise.all([
        chain.ldBalance(address).catch(() => 0n),
        chain.position(address).catch(() => ({ collateral_shares: 0n, debt: 0n })),
        chain.debtBalance(address).catch(() => 0n),
        chain.underlyingBalance(address).catch(() => 0n),
      ]);
      const shares = ld + pos.collateral_shares;
      const value = price ? (shares * price) / 1_000_000_000_000n : undefined;
      lines.push(
        [
          `${shortAddr(address)}`,
          `  ld${config.ASSET_ID}: ${amt(ld)} free · ${amt(pos.collateral_shares)} as collateral`,
          `  value: ${amt(value)} USDC at share price ${scaled(price)}`,
          `  debt: ${amt(pos.debt)} USDC`,
          `  wallet: ${amt(leod)} ${config.ASSET_ID} · ${amt(usdc)} USDC`,
        ].join("\n"),
      );
    }
    await ctx.reply(lines.join("\n\n"));
  });

  c.command("health", async (ctx) => {
    const addresses = await addressesOr(ctx);
    if (!addresses) return void ctx.reply("No address yet — /watch G… or /link.");
    const prefs = await prefsFor(ctx.chat.id);
    const lines: string[] = [];
    for (const address of addresses) {
      const [hf, pos] = await Promise.all([
        chain.healthFactor(address).catch(() => undefined),
        chain.position(address).catch(() => ({ collateral_shares: 0n, debt: 0n })),
      ]);
      lines.push(
        [
          shortAddr(address),
          `  ${hfLine(hf)}`,
          `  collateral ${amt(pos.collateral_shares)} ld${config.ASSET_ID} · debt ${amt(pos.debt)} USDC`,
        ].join("\n"),
      );
    }
    await ctx.reply(
      [
        ...lines,
        "",
        "Below 1.0 a whitelisted liquidator may act.",
        `Your alerts: warn below ${prefs.hf_warn}, urgent below ${prefs.hf_urgent}. /alerts to change.`,
      ].join("\n"),
    );
  });

  c.command("price", async (ctx) => {
    const asset = ((ctx.match ?? "").toString().trim() || config.ASSET_ID).toUpperCase();
    if (asset !== config.ASSET_ID.toUpperCase()) {
      await ctx.reply(`This deployment serves ${config.ASSET_ID} only.`);
      return;
    }
    const [nav, price] = await Promise.all([
      chain.nav(),
      chain.sharePrice().catch(() => undefined),
    ]);
    if (!nav.ok) {
      await ctx.reply(
        [
          `${asset} — HALTED (${nav.reason})`,
          "",
          "The oracle is fail-closed: rather than serve a stale or deviating price,",
          "the adapter reverts and everything that depends on it stops. Deposits and",
          "borrows are unavailable until it recovers.",
          "Withdrawals and repayments are never blocked by this.",
        ].join("\n"),
      );
      return;
    }
    await ctx.reply(
      [
        `${asset} NAV ${scaled(nav.nav, 6)} · updated ${ageLabel(nav.ts)}`,
        `Share price ld${asset}: ${scaled(price, 6)} USDC`,
      ].join("\n"),
    );
  });

  c.command("stats", async (ctx) => {
    const [m, price, tav] = await Promise.all([
      fetchMetrics(config.INDEXER_URL),
      chain.sharePrice().catch(() => undefined),
      chain.totalAssetsValue().catch(() => undefined),
    ]);
    if (!m) {
      await ctx.reply(
        `Indexer unreachable. Live from chain — TVL ${amt(tav)} USDC, share price ${scaled(price)}.`,
      );
      return;
    }
    await ctx.reply(
      [
        "Leontief — protocol",
        `  TVL: ${amt(tav)} USDC`,
        `  share price: ${scaled(price)}`,
        `  suppliers: ${m.unique_suppliers} · borrowers: ${m.active_borrowers}`,
        `  outstanding debt: ${amt(BigInt(m.total_debt || "0"))} USDC`,
        `  lifetime: ${m.lifetime.deposits} deposits · ${m.lifetime.borrows} borrows · ${m.lifetime.liquidations} liquidations`,
      ].join("\n"),
    );
  });

  // ── Preferences ────────────────────────────────────────────────────────────

  const alertsKeyboard = (p: { daily_digest: boolean; paused: boolean }) =>
    new InlineKeyboard()
      .text("warn 1.3", "warn:1.3")
      .text("1.5", "warn:1.5")
      .text("1.8", "warn:1.8")
      .row()
      .text("urgent 1.1", "urgent:1.1")
      .text("1.2", "urgent:1.2")
      .text("1.35", "urgent:1.35")
      .row()
      .text(p.daily_digest ? "daily digest: ON" : "daily digest: OFF", "digest:toggle")
      .row()
      .text(p.paused ? "alerts: PAUSED" : "alerts: ON", "pause:toggle");

  const prefsText = (p: {
    hf_warn: number;
    hf_urgent: number;
    daily_digest: boolean;
    paused: boolean;
  }) =>
    [
      "Alert preferences",
      `  warn below HF ${p.hf_warn}`,
      `  urgent below HF ${p.hf_urgent}`,
      `  daily digest: ${p.daily_digest ? "on" : "off"}`,
      `  delivery: ${p.paused ? "paused" : "on"}`,
      "",
      "Urgent alerts bypass the one-per-minute rate limit. Everything else waits its turn.",
    ].join("\n");

  c.command("alerts", async (ctx) => {
    const p = await prefsFor(ctx.chat.id);
    await ctx.reply(prefsText(p), { reply_markup: alertsKeyboard(p) });
  });

  c.callbackQuery(/^(warn|urgent):([\d.]+)$/, async (ctx) => {
    const [, key, value] = ctx.match as unknown as [string, string, string];
    const n = Number(value);
    const patch = key === "warn" ? { hf_warn: n } : { hf_urgent: n };
    const p = await updatePrefs(ctx.chat?.id ?? 0, patch);
    await ctx.answerCallbackQuery(`${key} set to ${n}`);
    await ctx.editMessageText(prefsText(p), { reply_markup: alertsKeyboard(p) });
  });

  c.callbackQuery("digest:toggle", async (ctx) => {
    const cur = await prefsFor(ctx.chat?.id ?? 0);
    const p = await updatePrefs(ctx.chat?.id ?? 0, { daily_digest: !cur.daily_digest });
    await ctx.answerCallbackQuery(p.daily_digest ? "digest on" : "digest off");
    await ctx.editMessageText(prefsText(p), { reply_markup: alertsKeyboard(p) });
  });

  c.callbackQuery("pause:toggle", async (ctx) => {
    const cur = await prefsFor(ctx.chat?.id ?? 0);
    const p = await updatePrefs(ctx.chat?.id ?? 0, { paused: !cur.paused });
    await ctx.answerCallbackQuery(p.paused ? "alerts paused" : "alerts on");
    await ctx.editMessageText(prefsText(p), { reply_markup: alertsKeyboard(p) });
  });

  c.command("pause", async (ctx) => {
    await updatePrefs(ctx.chat.id, { paused: true });
    await ctx.reply("Alerts paused. /resume to turn them back on.");
  });
  c.command("resume", async (ctx) => {
    await updatePrefs(ctx.chat.id, { paused: false });
    await ctx.reply("Alerts on.");
  });

  // ── Intents (quote + link; never execute) ──────────────────────────────────

  const intentCommand = (action: IntentAction) => async (ctx: CommandContext<Context>) => {
    const raw = (ctx.match ?? "").toString().trim().split(/\s+/);
    const parsed = parseAmount(raw[0] ?? "");
    if (parsed === null) {
      await ctx.reply(`Usage: /${action} <amount>  — e.g. /${action} 25`);
      return;
    }
    const asset = (raw[1] ?? config.ASSET_ID).toUpperCase();
    const url = intentUrl(app, { action, asset, amt: raw[0].replace(/,/g, "") });
    if (!url) {
      await ctx.reply("That amount or asset isn't something I can quote. Try /help.");
      return;
    }
    const quote = await quoteFor(action, parsed, ctx.chat.id);
    await ctx.reply([...quote, "", url, "", INTENT_FOOTER].join("\n"), {
      link_preview_options: { is_disabled: true },
    });
  };

  /** Live simulation-backed quote, so the number in Telegram is the number the
   *  app will show. Falls back to a plain restatement if a read fails. */
  async function quoteFor(action: IntentAction, amount: bigint, chatId: number): Promise<string[]> {
    const links = await linksFor(chatId);
    const address = links[0]?.address;
    try {
      if (action === "wrap") {
        const shares = await chain.quoteShares(amount);
        return [
          `Wrap ${amt(amount)} ${config.ASSET_ID} → ≈ ${amt(shares)} ld${config.ASSET_ID}`,
          "(≈ — the contract computes the exact mint on submit)",
        ];
      }
      if (!address) return [`${action} ${amt(amount)} — link an address for a live quote.`];
      if (action === "borrow" || action === "repay") {
        const delta = action === "borrow" ? amount : -amount;
        const post = await chain.previewHealthFactor(address, 0n, delta);
        const n = hfNumber(post ?? undefined);
        const label = n === null ? "no debt" : n === Number.POSITIVE_INFINITY ? "∞" : n.toFixed(3);
        return [
          `${action === "borrow" ? "Borrow" : "Repay"} ${amt(amount)} USDC`,
          `Projected health factor: ≈ ${label}`,
        ];
      }
      const post = await chain.previewHealthFactor(
        address,
        action === "supply" ? amount : -amount,
        0n,
      );
      const n = hfNumber(post ?? undefined);
      return [
        `${action === "supply" ? "Supply" : "Unwrap"} ${amt(amount)} ld${config.ASSET_ID}`,
        `Projected health factor: ≈ ${n === null ? "no debt" : n.toFixed(3)}`,
      ];
    } catch {
      return [`${action} ${amt(amount)} — quote unavailable right now (the oracle may be halted).`];
    }
  }

  for (const action of ["wrap", "unwrap", "supply", "borrow", "repay"] as const) {
    c.command(action, intentCommand(action));
  }

  return c;
}
