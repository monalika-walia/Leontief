# services/api

Leontief backend API (Fastify + Postgres). Today it serves the landing page's
**early-access intake**; it shares the same Postgres 16 instance the indexer
uses (`docker-compose.yml` at the repo root).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/early-access` | Upsert a signup `{ email, role?, assets?[], handle?, source? }` by email. Honeypot field `website` must be empty. Rate-limited (20/min/IP). |
| `GET` | `/early-access/count` | Aggregate signup count (never the list — that's PII). |
| `GET` | `/health` | Liveness + DB ping. |

Stored PII is minimal: email plus optional role/assets/handle, and a salted IP
**hash** (never the raw IP). One row per email; a resubmit updates it.

## Run

```sh
docker compose up -d postgres        # from repo root
pnpm --filter @leontief/api migrate  # create the early_access table
pnpm --filter @leontief/api dev      # http://localhost:8787
```

## Env

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://leontief:leontief@localhost:5432/leontief` | shared with the indexer |
| `PORT` | `8787` | |
| `CORS_ORIGINS` | localhost dev ports | comma-separated allowlist of landing origins |
| `IP_HASH_SALT` | dev salt | set in prod so IP hashes aren't guessable |

## Test

`pnpm --filter @leontief/api test` — schema validation unit tests (no DB needed).
