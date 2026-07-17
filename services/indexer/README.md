# services/indexer

TypeScript poller over Soroban RPC getEvents with a persisted cursor + Postgres 16 +
Fastify REST API (/metrics, /vaults/:id/history, /positions/at-risk, /health) — Phase A3.
Start Postgres locally with `docker compose up -d postgres`.
