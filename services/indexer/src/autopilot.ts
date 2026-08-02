// Autopilot grant/revoke/read endpoints (A8 Tier 2). Flag-gated: with
// AUTOPILOT_FLAG unset these routes are not registered at all, so a deployment
// that has not opted in cannot record a grant even by accident.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "./db.js";

const G_ADDRESS = /^G[A-Z2-7]{55}$/;
const STROOP = 10_000_000n;

const grantBody = z.object({
  address: z.string().regex(G_ADDRESS),
  strategy: z.enum(["digest-only", "hf-guard", "idle-sweep"]),
  perActionCap: z.string().regex(/^\d{1,12}(\.\d{1,7})?$/),
  dailyCap: z.string().regex(/^\d{1,12}(\.\d{1,7})?$/),
  // Spec: expiry ≤ 30 days. Enforced here, not just in the picker.
  expiryDays: z.number().int().min(1).max(30),
  sessionPublic: z.string().regex(G_ADDRESS),
  grantTx: z.string().max(80).optional(),
  chatId: z.number().int().optional(),
});

const toStroops = (s: string): bigint => {
  const [w, f = ""] = s.split(".");
  return BigInt(w) * STROOP + BigInt((f + "0000000").slice(0, 7));
};

export async function migrateAutopilot(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS autopilot_grants (
      address           TEXT PRIMARY KEY,
      strategy          TEXT NOT NULL DEFAULT 'digest-only',
      allowed_contracts TEXT[] NOT NULL DEFAULT '{}',
      per_action_cap    NUMERIC NOT NULL DEFAULT 0,
      daily_cap         NUMERIC NOT NULL DEFAULT 0,
      session_public    TEXT,
      expires_at        TIMESTAMPTZ NOT NULL,
      revoked           BOOLEAN NOT NULL DEFAULT false,
      chat_id           BIGINT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS autopilot_log (
      id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      address    TEXT NOT NULL,
      strategy   TEXT NOT NULL,
      action     TEXT NOT NULL,
      amount     NUMERIC NOT NULL DEFAULT 0,
      tx         TEXT,
      pre_hf     NUMERIC,
      post_hf    NUMERIC,
      outcome    TEXT NOT NULL,
      detail     TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS autopilot_log_addr ON autopilot_log (address, created_at DESC)`;
}

export function registerAutopilotRoutes(app: FastifyInstance): void {
  if (process.env.AUTOPILOT_FLAG !== "true") {
    app.log.info("autopilot routes disabled (AUTOPILOT_FLAG is not 'true')");
    return;
  }
  const allowed = [process.env.VAULT, process.env.MINI_POOL].filter(Boolean) as string[];

  app.post("/autopilot/grant", async (req, reply) => {
    const parsed = grantBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid", issues: parsed.error.issues });
    }
    const g = parsed.data;
    // The grant records LIMITS and the session PUBLIC key. The session secret
    // never reaches this service, and there is no column that could hold it.
    await sql`
      INSERT INTO autopilot_grants
        (address, strategy, allowed_contracts, per_action_cap, daily_cap, session_public,
         expires_at, revoked, chat_id)
      VALUES (${g.address}, ${g.strategy}, ${allowed}, ${toStroops(g.perActionCap).toString()},
              ${toStroops(g.dailyCap).toString()}, ${g.sessionPublic},
              now() + ${`${g.expiryDays} days`}::interval, false, ${g.chatId ?? null})
      ON CONFLICT (address) DO UPDATE SET
        strategy = EXCLUDED.strategy, allowed_contracts = EXCLUDED.allowed_contracts,
        per_action_cap = EXCLUDED.per_action_cap, daily_cap = EXCLUDED.daily_cap,
        session_public = EXCLUDED.session_public, expires_at = EXCLUDED.expires_at,
        revoked = false, chat_id = COALESCE(EXCLUDED.chat_id, autopilot_grants.chat_id)`;
    return reply.code(201).send({ ok: true });
  });

  app.post("/autopilot/revoke", async (req, reply) => {
    const body = z.object({ address: z.string().regex(G_ADDRESS) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid address" });
    // Revoking here is bookkeeping. The capability actually dies on-chain when
    // the user's set_options removes the signer; this row just stops the engine
    // from trying.
    await sql`UPDATE autopilot_grants SET revoked = true WHERE address = ${body.data.address}`;
    return { ok: true };
  });

  app.get<{ Params: { address: string } }>("/autopilot/:address", async (req, reply) => {
    if (!G_ADDRESS.test(req.params.address)) return reply.code(400).send({ error: "invalid" });
    const [grant] = await sql`
      SELECT strategy, session_public, expires_at, revoked,
             per_action_cap::text, daily_cap::text
      FROM autopilot_grants WHERE address = ${req.params.address}`;
    const log = await sql`
      SELECT action, amount::text, tx, pre_hf::text, post_hf::text, outcome, detail, created_at
      FROM autopilot_log WHERE address = ${req.params.address}
      ORDER BY created_at DESC LIMIT 50`;
    return { grant: grant ?? null, log };
  });
}
