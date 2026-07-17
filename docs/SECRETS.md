# docs/SECRETS.md — secrets matrix (D4)

Every secret, where it lives, and who rotates it. **Rule (CLAUDE.md / D3):** the
testnet deployer key may live in GitHub Actions secrets; **mainnet keys NEVER
touch CI** — they are hardware-wallet signers only (see `docs/MULTISIG.md` at T3).

| Secret | Lives in | Set by / rotation owner | Notes |
|---|---|---|---|
| Testnet deployer + demo secret keys (`DEMO_*_SK`) | `deploy.env` (gitignored); baked into the dApp bundle for `/demo` | regenerated every `setup_testnet.sh` run (Vyom) | Throwaway testnet keys. Public exposure in the client bundle is acceptable — testnet only. |
| Vercel deploy token | local shell / CI secret `VERCEL_TOKEN` | account owner (Kunal) — rotate after any paste into logs | Never committed. Deploys landing + dApp. |
| Render API key (`RENDER_API_KEY`) | local interactive session (`claude mcp add render …`) | account owner | API-key auth; used to deploy `render.yaml`. Not in CI. |
| `DATABASE_URL` (API Postgres) | Render service env (injected from managed Postgres) | Render / DevOps | Never hand-set; comes from `render.yaml` `fromDatabase`. |
| `IP_HASH_SALT` (API) | Render service env (`generateValue`) | Render | Salts stored IP hashes so they aren't guessable. |
| `CORS_ORIGINS` (API) | Render service env (`render.yaml`) | DevOps | Allowlist of landing/app origins. Not secret, but env-managed. |
| `DISCORD_WEBHOOK_URL` (monitor) | monitor host env / GH Actions secret | DevOps (Vyom) | Alert sink; treat as secret (anyone with it can post). |
| `HEALTHCHECK_URL` (monitor) | monitor host env | DevOps | Heartbeat ping URL (Healthchecks.io). |
| Sentry DSN (frontend) | Vercel project env `VITE_SENTRY_DSN` | DevOps | Public-ish (client DSN) but env-managed; enables error capture. |
| Mainnet admin/multisig signer keys | **hardware wallets only** | each signer (Monalika / Aditya / Vyom) | NEVER in CI, Vercel, Render, or any `.env`. Geo-separated. Signer change → KYC re-verification (SCF rule). |
| Mainnet RPC provider key (if any) | Render/host env, read at runtime | DevOps | Provider chosen in DECISIONS.md; never hardcoded. |

## Where each surface reads secrets

- **GitHub Actions** — `VERCEL_TOKEN` (optional deploy job), `DISCORD_WEBHOOK_URL`
  (nightly monitor). Testnet deployer key allowed; mainnet keys forbidden.
- **Vercel** — `VITE_SENTRY_DSN`; the dApp's `VITE_*` contract IDs (baked at build).
- **Render** — `DATABASE_URL`, `IP_HASH_SALT`, `CORS_ORIGINS`, `PORT` (all in
  `render.yaml`).
- **Local** — `deploy.env` (gitignored) + `app/.env.local` (generated); see
  `app/.env.example`, `services/api/.env.example`.

No row is "TBD".
