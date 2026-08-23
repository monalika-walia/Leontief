# docs/MONITORING.md — ops & alerting (docs-hub §05, D4)

## Alert conditions → sink

The monitor (`services/monitor`) reads the live contracts each cycle and posts to
a **Discord webhook** when any of these trip; it pings **Healthchecks.io** every
cycle so silence itself is an alert.

| Condition | Threshold | Source |
|---|---|---|
| share_price discontinuity | step > **25 bps** vs last observed | `vault.share_price` |
| Oracle staleness | NAV age > **80% of max_age** (default 72 000 s) | `adapter.get_nav` ts |
| Oracle **HALTED** | `get_nav` reverts (Stale / Deviation / Unconfigured) | `adapter.get_nav` |
| Vault paused | `is_paused == true` | `vault.is_paused` |
| Cap utilization | > **80%** | `vault.total_assets_value` / `vault.cap` |
| `override_accepted` / `paused` events | any occurrence | contract events (roadmap: needs the A3 indexer cursor) |
| Positions at hf < 1 | count > 0 | needs the A3 indexer (positions snapshot) |

> The last two rows are wired in the design but require the indexer (A3) to
> enumerate positions/events; the monitor covers everything readable without it.

## Run

```sh
# one-shot (cron-friendly), reads contract IDs from env:
RPC_URL=https://soroban-testnet.stellar.org \
VAULT=<id> ORACLE_ADAPTER=<id> ASSET_ID=LEOD \
DISCORD_WEBHOOK_URL=<hook> HEALTHCHECK_URL=<ping> \
pnpm --filter @leontief/monitor once

# continuous:
… POLL_SECS=60 pnpm --filter @leontief/monitor watch
```

Scheduling options: a Render **Cron Job** (every 5 min) reusing the API's env
group, a GitHub Actions scheduled job, or the `--loop` mode on any always-on
host. Drills (docs-hub §05): a forced oracle-stale drill on testnet must fire the
staleness alert ≤ 5 min; killing the monitor must trip the Healthchecks silence
alert.

## Frontend errors — Sentry

The dApp reads `VITE_SENTRY_DSN` from env; when set, unhandled errors are
captured. DSN lives in Vercel project env (see `docs/SECRETS.md`). No DSN → no-op
(never blocks the app).

## Status page

A public status page (Upptime — GitHub-based, free — or Instatus) monitors three
canaries: an RPC read (`getNetwork` on the testnet RPC), the dApp URL, and the
API `/health`. Upptime config lives in its own repo/workflow; link it from the
docs site (S1).

## Pause playbook (docs-hub §05)

Trigger criteria → oracle halt > 6 h, issuer action, or an invariant alarm from
this monitor. Response: multisig `pause(vault)` (at mainnet) → status page +
Discord notice ≤ 1 h → post-mortem in `DECISIONS.md` ≤ 72 h. **Exits are never
paused.** On-call rotation of 3 (Monalika / Aditya / Vyom).

## Delegated-surface runbook (Telegram + Autopilot — Tranche 2 scope)

*Updated August 2026. These procedures ship with the surface; written before it does.*

- **Autopilot pause / revoke.** User-side: one-tap revoke in the dApp kills the delegation at the
  ledger — the acceptance test is that the engine's next action attempt fails on-chain. Ops-side:
  the engine runs behind a feature flag; flipping it stops all engine action immediately for
  everyone (see kill-switch below). Either path is safe at any time: the engine only *maintains*
  positions, so stopping it never traps funds — users keep full manual control, and **exits are
  never pausable**.
- **Bot-token rotation.** Rotate the Telegram bot token via BotFather → update the deployment
  secret (`TELEGRAM_BOT_TOKEN`, rotation owner in `docs/SECRETS.md`) → webhook re-registered with a
  fresh webhook secret. Blast radius of a leaked token is notifications only (the bot holds no
  keys, CI-grepped), but rotate on any suspicion and post a notice, since a hijacked bot could
  phish.
- **Engine kill-switch.** Single flag (env/config), owner: on-call. Off = the engine signs nothing,
  regardless of live delegations; delegations then simply expire (≤ 30 days) or are revoked
  user-side. Production bundles exclude the engine module entirely — verified in CI.
