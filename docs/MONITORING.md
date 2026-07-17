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
