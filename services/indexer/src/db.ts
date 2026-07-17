import postgres from "postgres";

// Shares the Postgres 16 instance with the API (docker-compose.yml).
export const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://leontief:leontief@localhost:5432/leontief",
  { max: 5, idle_timeout: 20 },
);

/** Idempotent schema. events is the raw log; the rest are derived views the API
 *  serves. A unique (ledger, tx_hash, event_index) proves no duplicate rows on
 *  restart (the cursor resumes exactly once). */
export async function migrate(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      contract_id  TEXT NOT NULL,
      topic        TEXT NOT NULL,
      ledger       BIGINT NOT NULL,
      ts           TIMESTAMPTZ NOT NULL,
      tx_hash      TEXT NOT NULL,
      event_index  INTEGER NOT NULL,
      data         JSONB NOT NULL DEFAULT '{}'
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS events_unique
      ON events (ledger, tx_hash, event_index)
  `;
  await sql`CREATE INDEX IF NOT EXISTS events_topic_ts ON events (topic, ts)`;

  await sql`
    CREATE TABLE IF NOT EXISTS share_price_series (
      vault       TEXT NOT NULL,
      ts          TIMESTAMPTZ NOT NULL,
      share_price NUMERIC NOT NULL,
      PRIMARY KEY (vault, ts)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS positions_snapshot (
      account            TEXT PRIMARY KEY,
      collateral_shares  NUMERIC NOT NULL DEFAULT 0,
      debt               NUMERIC NOT NULL DEFAULT 0,
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS metrics_daily (
      day          DATE PRIMARY KEY,
      deposits     NUMERIC NOT NULL DEFAULT 0,
      withdrawals  NUMERIC NOT NULL DEFAULT 0,
      borrows      NUMERIC NOT NULL DEFAULT 0,
      liquidations INTEGER NOT NULL DEFAULT 0
    )
  `;
  // Persisted RPC cursor — never gap (public RPC event retention is days).
  await sql`
    CREATE TABLE IF NOT EXISTS cursor (
      id           INTEGER PRIMARY KEY DEFAULT 1,
      last_ledger  BIGINT NOT NULL DEFAULT 0,
      discontinuity BOOLEAN NOT NULL DEFAULT false,
      CHECK (id = 1)
    )
  `;
  await sql`INSERT INTO cursor (id, last_ledger) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`;
}
