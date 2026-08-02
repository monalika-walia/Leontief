# @leontief/bot — the Leontief Telegram bot (A8 Tier 1)

Reads, alerts, and deep-link intents for the live testnet beta. grammY in
webhook mode, deployed beside the indexer and sharing its Postgres.

## The one hard rule

**This service never receives, stores, or requests a secret key or seed phrase —
not "encrypted", not "temporarily", not ever. It has no signing capability at
all.**

That is enforced three ways, in increasing order of strength:

1. **Copy** — `/start` says it out loud, so a user being phished has something to
   check against.
2. **Structure** — [`src/chain.ts`](src/chain.ts) wraps `LeontiefClient` in a
   read-only facade. Every SDK write method requires a `Signer`, and no `Signer`
   is ever constructed here: nothing in this process can produce a signature.
3. **CI** — `scripts/check_bot_cannot_sign.sh` fails the build on any
   signing-shaped identifier or protocol write call under `src/`. Comment lines
   are stripped first, so the anti-phishing copy can say "secret key" while any
   code that could handle one fails.

The action commands (`/wrap`, `/unwrap`, `/supply`, `/borrow`, `/repay`) **do not
execute anything**. They quote from a live simulation and reply with a deep link
into the dApp, where the user signs in their own wallet.

## Commands

| Command | Behaviour |
|---|---|
| `/start`, `/help` | what it does, what it cannot do, anti-phishing note |
| `/watch G…` | follow any address, read-only, unverified |
| `/link`, `/unlink` | prove an address is yours (SEP-53), or unbind |
| `/positions` | ld balances free + as collateral, value, debt, wallet balances |
| `/health` | HF with the app's **SAFE / MODERATE / AT RISK** bands |
| `/price [ASSET]` | NAV + freshness; `HALTED` with the fail-closed copy when the adapter reverts |
| `/stats` | TVL, share price, suppliers, borrowers, lifetime counts |
| `/alerts`, `/pause`, `/resume` | inline-keyboard preferences |
| `/wrap /unwrap /supply /borrow /repay` | quote + deep link — never executes |

## Alerts

- **HF band changes**, with hysteresis: worsening alerts immediately, recovery
  must clear the threshold by 2%. An HF oscillating around 1.500 produces one
  message, not one per poll.
- **Oracle HALTED / recovered**, broadcast once per state change.
- **Daily digest** (opt-in): the share-price delta — "your position earned while
  you slept".

Rate limit: one message per chat per minute, **except urgent**, which is the one
case where being noisy is correct.

## Run

```sh
docker compose up -d postgres
pnpm --filter @leontief/indexer migrate     # the indexer owns the schema
just bot                                    # migrate + run

# point Telegram at this deployment
PUBLIC_URL=https://bot.leontief.tech pnpm --filter @leontief/bot set-webhook
```

`assertSchema()` refuses to boot against an unmigrated database rather than
half-working.

## Config

All validated by zod at boot; a missing value exits with a readable list rather
than a stack trace. Note what is **not** in [`src/config.ts`](src/config.ts):
there is no key, seed, or signer setting, and adding one would be a review
failure.

`BOT_TOKEN` · `WEBHOOK_SECRET` (compared against
`X-Telegram-Bot-Api-Secret-Token` on every webhook POST) · `DATABASE_URL` ·
`APP_BASE_URL` · `INDEXER_URL` · `RPC_URL` · contract IDs · `BOT_HANDLE`.

Secrets live in the D4 matrix — `docs/SECRETS.md`.

## Test

```sh
pnpm --filter @leontief/bot test          # pure logic: bands, hysteresis, intents
./scripts/check_bot_cannot_sign.sh        # the no-signing gate
```

Full design notes, the SEP-53 details, and the alert semantics:
`INTEGRATIONS/telegram.md`.
