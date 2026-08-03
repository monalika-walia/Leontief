// Postgres access. The schema itself is owned by services/indexer (it owns
// migrations and the app's /tg/link endpoint writes to the same tables); this
// service only reads and writes rows. Booting against an unmigrated database
// fails loudly rather than half-working.
import postgres from "postgres";
import type { AlertBand } from "./alertLogic.js";

export const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://leontief:leontief@localhost:5432/leontief",
  { max: 5, idle_timeout: 20 },
);

export async function assertSchema(): Promise<void> {
  const [row] = await sql<{ missing: string[] }[]>`
    SELECT array_agg(t) AS missing FROM unnest(
      ARRAY['tg_links','tg_link_codes','alert_prefs','alert_log']
    ) AS t
    WHERE to_regclass('public.' || t) IS NULL`;
  if (row?.missing?.length) {
    throw new Error(
      `bot: missing tables [${row.missing.join(", ")}] — run \`pnpm --filter @leontief/indexer migrate\` first`,
    );
  }
}

export type Prefs = { hf_warn: number; hf_urgent: number; daily_digest: boolean; paused: boolean };

const DEFAULT_PREFS: Prefs = { hf_warn: 1.5, hf_urgent: 1.2, daily_digest: false, paused: false };

export async function prefsFor(chatId: number): Promise<Prefs> {
  const [row] = await sql<
    { hf_warn: string; hf_urgent: string; daily_digest: boolean; paused: boolean }[]
  >`SELECT hf_warn::text, hf_urgent::text, daily_digest, paused FROM alert_prefs WHERE chat_id = ${chatId}`;
  if (!row) return { ...DEFAULT_PREFS };
  return {
    hf_warn: Number(row.hf_warn),
    hf_urgent: Number(row.hf_urgent),
    daily_digest: row.daily_digest,
    paused: row.paused,
  };
}

export async function updatePrefs(chatId: number, patch: Partial<Prefs>): Promise<Prefs> {
  const current = await prefsFor(chatId);
  const next = { ...current, ...patch };
  await sql`
    INSERT INTO alert_prefs (chat_id, hf_warn, hf_urgent, daily_digest, paused)
    VALUES (${chatId}, ${next.hf_warn}, ${next.hf_urgent}, ${next.daily_digest}, ${next.paused})
    ON CONFLICT (chat_id) DO UPDATE SET
      hf_warn = EXCLUDED.hf_warn, hf_urgent = EXCLUDED.hf_urgent,
      daily_digest = EXCLUDED.daily_digest, paused = EXCLUDED.paused`;
  return next;
}

export type Link = { chat_id: number; address: string; verified: boolean };

export async function linksFor(chatId: number): Promise<Link[]> {
  const rows = await sql<{ chat_id: string; address: string; verified: boolean }[]>`
    SELECT chat_id, address, verified FROM tg_links WHERE chat_id = ${chatId} ORDER BY created_at`;
  return rows.map((r) => ({
    chat_id: Number(r.chat_id),
    address: r.address,
    verified: r.verified,
  }));
}

/** Every chat watching an address, for fan-out of position alerts. */
export async function allLinks(): Promise<Link[]> {
  const rows = await sql<{ chat_id: string; address: string; verified: boolean }[]>`
    SELECT chat_id, address, verified FROM tg_links`;
  return rows.map((r) => ({
    chat_id: Number(r.chat_id),
    address: r.address,
    verified: r.verified,
  }));
}

export async function addWatch(chatId: number, address: string): Promise<void> {
  await sql`
    INSERT INTO tg_links (chat_id, address, verified, method)
    VALUES (${chatId}, ${address}, false, 'watch')
    ON CONFLICT (chat_id, address) DO NOTHING`;
  await sql`INSERT INTO alert_prefs (chat_id) VALUES (${chatId}) ON CONFLICT (chat_id) DO NOTHING`;
}

export async function removeLink(chatId: number, address?: string): Promise<number> {
  const rows = address
    ? await sql`DELETE FROM tg_links WHERE chat_id = ${chatId} AND address = ${address} RETURNING address`
    : await sql`DELETE FROM tg_links WHERE chat_id = ${chatId} RETURNING address`;
  return rows.length;
}

/** Mint a one-time link code. Alphabet excludes look-alikes (0/O, 1/I). */
export async function mintLinkCode(chatId: number, ttlMinutes = 15): Promise<string> {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  await sql`
    INSERT INTO tg_link_codes (code, chat_id, expires_at)
    VALUES (${code}, ${chatId}, now() + ${`${ttlMinutes} minutes`}::interval)`;
  return code;
}

export async function lastBand(chatId: number, address: string): Promise<AlertBand | null> {
  const [row] = await sql<{ band: string }[]>`
    SELECT band FROM alert_log
    WHERE chat_id = ${chatId} AND address = ${address} AND kind = 'hf' AND band IS NOT NULL
    ORDER BY sent_at DESC LIMIT 1`;
  return (row?.band as AlertBand) ?? null;
}

export async function lastSentAt(chatId: number): Promise<number | null> {
  const [row] = await sql<{ sent_at: Date }[]>`
    SELECT sent_at FROM alert_log WHERE chat_id = ${chatId} ORDER BY sent_at DESC LIMIT 1`;
  return row ? row.sent_at.getTime() : null;
}

export async function logAlert(a: {
  chatId: number;
  address?: string;
  kind: string;
  band?: string;
  body: string;
}): Promise<void> {
  await sql`
    INSERT INTO alert_log (chat_id, address, kind, band, body)
    VALUES (${a.chatId}, ${a.address ?? null}, ${a.kind}, ${a.band ?? null}, ${a.body})`;
}

/** Verified users, for broadcasts (oracle state changes). */
export async function verifiedChats(): Promise<number[]> {
  const rows = await sql<{ chat_id: string }[]>`
    SELECT DISTINCT l.chat_id FROM tg_links l
    LEFT JOIN alert_prefs p ON p.chat_id = l.chat_id
    WHERE l.verified = true AND COALESCE(p.paused, false) = false`;
  return rows.map((r) => Number(r.chat_id));
}
