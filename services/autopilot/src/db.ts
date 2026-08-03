// Grants and the action log.
//
// The session secret is NOT stored here in any form a reviewer should accept
// silently — see signer.ts for what is held and why. This module stores the
// grant's LIMITS and its audit trail, which is the part that must survive a
// restart and be readable by the user.
import postgres from "postgres";
import type { Grant } from "./policy.js";

export const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://leontief:leontief@localhost:5432/leontief",
  { max: 5, idle_timeout: 20 },
);

export async function migrate(): Promise<void> {
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

export type GrantRow = Grant & { sessionPublic: string | null; chatId: number | null };

export async function activeGrants(): Promise<GrantRow[]> {
  const rows = await sql<
    {
      address: string;
      strategy: string;
      allowed_contracts: string[];
      per_action_cap: string;
      daily_cap: string;
      session_public: string | null;
      expires_at: Date;
      revoked: boolean;
      chat_id: string | null;
    }[]
  >`SELECT * FROM autopilot_grants WHERE revoked = false AND expires_at > now()`;
  return rows.map((r) => ({
    user: r.address,
    strategy: r.strategy as Grant["strategy"],
    allowedContracts: r.allowed_contracts,
    perActionCap: BigInt(r.per_action_cap),
    dailyCap: BigInt(r.daily_cap),
    expiresAt: Math.floor(r.expires_at.getTime() / 1000),
    revoked: r.revoked,
    sessionPublic: r.session_public,
    chatId: r.chat_id === null ? null : Number(r.chat_id),
  }));
}

/** Notional already spent today, and how long since the last successful action. */
export async function spendState(
  address: string,
): Promise<{ spentToday: bigint; secondsSinceLastAction: number | null }> {
  const [spent] = await sql<{ total: string }[]>`
    SELECT COALESCE(sum(amount), 0)::text AS total FROM autopilot_log
    WHERE address = ${address} AND outcome = 'executed' AND created_at > now() - interval '24 hours'`;
  const [last] = await sql<{ created_at: Date }[]>`
    SELECT created_at FROM autopilot_log
    WHERE address = ${address} AND outcome = 'executed' ORDER BY created_at DESC LIMIT 1`;
  return {
    spentToday: BigInt(spent?.total ?? "0"),
    secondsSinceLastAction: last
      ? Math.floor((Date.now() - last.created_at.getTime()) / 1000)
      : null,
  };
}

export async function logAction(a: {
  address: string;
  strategy: string;
  action: string;
  amount: bigint;
  tx?: string;
  preHf?: bigint | null;
  postHf?: bigint | null;
  outcome: "executed" | "refused" | "failed";
  detail?: string;
}): Promise<void> {
  await sql`
    INSERT INTO autopilot_log (address, strategy, action, amount, tx, pre_hf, post_hf, outcome, detail)
    VALUES (${a.address}, ${a.strategy}, ${a.action}, ${a.amount.toString()}, ${a.tx ?? null},
            ${a.preHf?.toString() ?? null}, ${a.postHf?.toString() ?? null}, ${a.outcome},
            ${a.detail ?? null})`;
}

export async function revoke(address: string): Promise<void> {
  await sql`UPDATE autopilot_grants SET revoked = true WHERE address = ${address}`;
}
