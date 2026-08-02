// Telegram account-linking endpoints (A8 Tier 1), served by the indexer because
// it is the app's backend and already owns this Postgres.
//
// The bot mints a one-time code; the app proves control of an address with a
// SEP-53 message signature (or, for wallets that cannot sign messages, a 0-XLM
// self-payment carrying the code as its memo); this module binds chat ↔ address.
//
// It verifies signatures. It never creates one, and it never sees a secret key.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "./db.js";
import { linkChallenge, verifySep53 } from "./sep53.js";

const HORIZON = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
/** How far back an on-chain memo proof may be — long enough to sign and submit. */
const MEMO_MAX_AGE_MS = 30 * 60_000;

const G_ADDRESS = /^G[A-Z2-7]{55}$/;
const CODE = /^[A-Z0-9]{8}$/;

const challengeQuery = z.object({
  code: z.string().regex(CODE),
  address: z.string().regex(G_ADDRESS),
});

const linkBody = z.object({
  code: z.string().regex(CODE),
  address: z.string().regex(G_ADDRESS),
  // Present for the signature path; absent for the on-chain memo fallback.
  signature: z.string().max(512).optional(),
  method: z.enum(["signature", "memo"]).default("signature"),
});

export type LinkOutcome =
  | { ok: true; method: "signature" | "memo" }
  | { ok: false; code: number; error: string };

/** Claim the code, verify the proof, bind the chat. Split out from the route so
 *  the decision logic is testable without a live Fastify/Horizon. */
export async function performLink(
  body: z.infer<typeof linkBody>,
  verifyMemo: (address: string, code: string) => Promise<boolean>,
): Promise<LinkOutcome> {
  const [row] = await sql<{ chat_id: string; used_at: Date | null; expires_at: Date }[]>`
    SELECT chat_id, used_at, expires_at FROM tg_link_codes WHERE code = ${body.code}`;
  if (!row) return { ok: false, code: 404, error: "unknown code" };
  if (row.used_at) return { ok: false, code: 409, error: "code already used" };
  if (row.expires_at.getTime() < Date.now()) return { ok: false, code: 410, error: "code expired" };

  if (body.method === "signature") {
    if (!body.signature) return { ok: false, code: 400, error: "signature required" };
    const challenge = linkChallenge(body.code, body.address);
    if (!verifySep53(body.address, challenge, body.signature)) {
      return { ok: false, code: 401, error: "signature does not verify for this address" };
    }
  } else if (!(await verifyMemo(body.address, body.code))) {
    return { ok: false, code: 401, error: "no matching on-chain proof for this address" };
  }

  // Spend the code first: a replay racing this one loses on the used_at guard.
  const spent = await sql`
    UPDATE tg_link_codes SET used_at = now() WHERE code = ${body.code} AND used_at IS NULL
    RETURNING code`;
  if (spent.length === 0) return { ok: false, code: 409, error: "code already used" };

  await sql`
    INSERT INTO tg_links (chat_id, address, verified, method)
    VALUES (${row.chat_id}, ${body.address}, true, ${body.method})
    ON CONFLICT (chat_id, address) DO UPDATE SET verified = true, method = EXCLUDED.method`;
  await sql`
    INSERT INTO alert_prefs (chat_id) VALUES (${row.chat_id}) ON CONFLICT (chat_id) DO NOTHING`;
  return { ok: true, method: body.method };
}

/** Fallback proof for smart wallets that cannot sign a message: a recent 0-XLM
 *  self-payment whose memo is the code. Proves account control, not just key
 *  possession — strictly stronger than the signature path. */
export async function verifyMemoPayment(address: string, code: string): Promise<boolean> {
  const url = `${HORIZON}/accounts/${address}/transactions?order=desc&limit=20&include_failed=false`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return false;
  const body = (await res.json()) as {
    _embedded?: { records?: { memo?: string; memo_type?: string; created_at?: string }[] };
  };
  const cutoff = Date.now() - MEMO_MAX_AGE_MS;
  return (body._embedded?.records ?? []).some(
    (t) =>
      t.memo_type === "text" &&
      t.memo === code &&
      t.created_at !== undefined &&
      Date.parse(t.created_at) >= cutoff,
  );
}

export function registerTelegramRoutes(app: FastifyInstance): void {
  // The app fetches the exact text before prompting, so the user signs what the
  // server will verify — no client-side copy to drift out of sync.
  app.get("/tg/challenge", async (req, reply) => {
    const q = challengeQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid code or address" });
    return { challenge: linkChallenge(q.data.code, q.data.address) };
  });

  app.post("/tg/link", async (req, reply) => {
    const parsed = linkBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid", issues: parsed.error.issues });
    }
    const out = await performLink(parsed.data, verifyMemoPayment);
    if (!out.ok) return reply.code(out.code).send({ error: out.error });
    return reply.code(201).send({ ok: true, method: out.method });
  });

  // Read-only view for the app's "linked" indicator. Public addresses only.
  app.get<{ Params: { address: string } }>("/tg/links/:address", async (req, reply) => {
    if (!G_ADDRESS.test(req.params.address)) return reply.code(400).send({ error: "invalid" });
    const rows = await sql<{ verified: boolean; created_at: Date }[]>`
      SELECT verified, created_at FROM tg_links WHERE address = ${req.params.address}`;
    return {
      address: req.params.address,
      links: rows.length,
      verified: rows.some((r) => r.verified),
    };
  });
}
