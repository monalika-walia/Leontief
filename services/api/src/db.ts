import postgres from "postgres";

/**
 * Single shared Postgres client. Reuses the indexer's Postgres 16 instance
 * (docker-compose.yml) — the landing intake and the indexer are one datastore.
 */
export const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://leontief:leontief@localhost:5432/leontief",
  { max: 5, idle_timeout: 20 },
);

/** Idempotent schema bootstrap for the early-access intake. */
export async function migrate(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS early_access (
      id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email       TEXT NOT NULL,
      role        TEXT,
      assets      TEXT[] NOT NULL DEFAULT '{}',
      handle      TEXT,
      source      TEXT NOT NULL DEFAULT 'landing',
      ip_hash     TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // One signup per email (case-insensitive); a resubmit updates the row.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS early_access_email_key ON early_access (lower(email))`;
}
