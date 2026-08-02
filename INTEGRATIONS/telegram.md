# INTEGRATIONS/telegram.md — Leontief bot (A8 Tier 1)

**Written: 2026-08-02.** Facts about SEP-53 and grammY below are read from the
spec and the installed typings on that date, and the SEP-53 algorithm is pinned
by the spec's own test vectors in CI (CLAUDE.md: never from memory).

## The one hard rule

**The bot never receives, stores, or requests a secret key or seed phrase — not
"encrypted", not "temporarily", not ever. Tier 1 has no signing capability at
all.**

Three independent things enforce that, in increasing order of strength:

1. **Copy** — `/start` says it out loud, so a user who is being phished has a
   reference point (`ANTI_PHISHING` in `services/bot/src/commands.ts`).
2. **Structure** — `services/bot/src/chain.ts` wraps `LeontiefClient` in a
   read-only facade. Every SDK write method requires a `Signer`, and no `Signer`
   is ever constructed in this service: there is nothing in the process capable
   of producing a signature.
3. **CI** — `scripts/check_bot_cannot_sign.sh` fails the build on any
   signing-shaped identifier (`Keypair`, `fromSecret`, `.sign(`, `Signer`,
   `…_SK`, `mnemonic`, …) or any protocol write call under `services/bot/src`.
   Comment lines are stripped first, so the anti-phishing copy can say "secret
   key" while any code that could handle one fails. The gate is verified against
   a deliberate violation, not just asserted.

## Shape

```
Telegram ──webhook──▶ services/bot ──reads──▶ Soroban RPC (simulation only)
                            │        └──────▶ services/indexer /metrics, /vaults/:id/history
                            ├──writes rows──▶ Postgres (schema owned by the indexer)
                            └──messages────▶ users, every one carrying an app deep link

dApp ──POST /tg/link──▶ services/indexer (verifies SEP-53) ──▶ binds chat ↔ address
```

`services/bot` is deployed beside the indexer on Render (`render.yaml`), sharing
one Postgres. Webhook mode, not long polling: grammY 1.45's
`webhookCallback(bot, "fastify", { secretToken })` compares the shared secret
against `X-Telegram-Bot-Api-Secret-Token` on every POST (verified against the
installed `grammy/out/convenience/webhook.d.ts`, 2026-08-02), so a leaked URL is
not enough to inject updates. Per-chat rate limiting via `@fastify/rate-limit`.

## Tables (owned by `services/indexer/src/db.ts`)

| Table | Holds |
|---|---|
| `tg_link_codes` | one-time codes: `code`, `chat_id`, `expires_at` (15 min), `used_at` |
| `tg_links` | `chat_id` ↔ **public address**, `verified`, `method` (`signature` / `memo` / `watch`) |
| `alert_prefs` | `hf_warn` (1.5), `hf_urgent` (1.2), `daily_digest`, `paused` |
| `alert_log` | delivery log — doubles as hysteresis memory (last band) and the rate limiter's clock |

Nothing signable is stored. `tg_links` binds a chat to a G-address, which is
public information already.

## Account linking

**Watch-only** — `/watch G…` follows any address, marked unverified. Read-only
data and default alert thresholds; no preferences. Deliberately open: watching a
public address needs no proof, and a curious user should be able to try the bot
without a wallet ceremony.

**Verified** — `/link` mints a one-time code and points the user at
`app.leontief.tech/link?code=…`:

1. The app (already wallet-connected) fetches `GET /tg/challenge?code=&address=`
   from the indexer and **displays the exact text it is about to sign**. The
   challenge is derived server-side from `(code, address)` alone, so the client
   cannot choose what gets signed and a signature captured elsewhere cannot be
   replayed into a link request.
2. The wallet signs it via Stellar Wallets Kit `signMessage` (SEP-53).
3. The app POSTs `{code, address, signature}` to `POST /tg/link`; the indexer
   verifies, spends the code (a racing replay loses on the `used_at` guard), and
   binds the chat.

### SEP-53, exactly

Source: [SEP-0053](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md),
read 2026-08-02.

- Canonical payload: `"Stellar Signed Message:\n" || message` (UTF-8 concat).
- **The signature is ed25519 over `SHA256(payload)`, not over the raw message.**
  Getting this wrong verifies nothing and fails open-ish, so
  `services/indexer/src/sep53.test.ts` asserts all three of the spec's published
  vectors byte-for-byte (ASCII, Japanese, binary) plus negative cases: a
  signature over the raw message, a replay onto a different message, and the
  same signature claimed for a different address.
- Signatures are accepted as base64 or hex; anything that isn't 64 bytes is
  rejected without throwing.

**Documented limitation, quoted from the spec:** *"Ownership of a private key
does not imply control of the account… In multi-signer scenarios, possession of
just one key may not grant full control over the account."* That is acceptable
here — a verified link grants **read access to public data plus notifications**,
nothing more. Accounts wanting account-level proof use the fallback below, which
is strictly stronger.

### Smart-wallet fallback

Wallets that cannot sign messages (passkey/smart wallets) send themselves a
**0-XLM payment with the code as the text memo**; the indexer verifies it on
Horizon within a 30-minute window. This proves control of the *account*, not just
possession of a key.

## Commands

| Command | Behaviour |
|---|---|
| `/start`, `/help` | what it does, and the anti-phishing note |
| `/watch G…`, `/link`, `/unlink` | account binding |
| `/positions` | ld balances (free + collateral), value at share price, debt, wallet balances |
| `/health` | HF with the app's gauge vocabulary — **SAFE / MODERATE / AT RISK**, thresholds 1.5 and 1.1, matching `HealthGauge.tsx` |
| `/price [ASSET]` | NAV + freshness age; renders `HALTED` with the fail-closed copy when the adapter reverts |
| `/stats` | TVL, share price, suppliers, borrowers, lifetime counts (indexer `/metrics`, with a chain-read fallback) |
| `/alerts`, `/pause`, `/resume` | inline-keyboard preference editor |
| `/wrap`, `/unwrap`, `/supply`, `/borrow`, `/repay` | **quote + deep link. Never execute.** |

Telegram is text-only, which makes the app's "never colours-only" accessibility
rule free: every risk band is a word.

## Deep-link intents

`app.leontief.tech/intent?action=wrap|unwrap|supply|borrow|repay&asset=…&amt=…`

Validated twice — once by the bot when building the link
(`services/bot/src/intents.ts`) and again by the app on arrival
(`app/src/lib/intent.ts`), because a link is user input: it can be hand-edited or
forwarded by a stranger. A valid intent forwards to the panel that owns the
action, seeds the tab and amount, and **focuses the confirm button**. Invalid
parameters get a readable error page that tells the user to distrust the link —
never a crash, never a half-filled form.

**It never auto-submits.** The user reads the numbers and signs in their own
wallet, exactly as if they had typed them.

Action-command replies carry a live simulation-backed quote (`quoteShares` for
wraps, `previewHealthFactor` for pool actions) so the number in Telegram is the
number the app will show.

## Alerts

| Trigger | Behaviour |
|---|---|
| HF crossing `hf_warn` / `hf_urgent` | per-user thresholds, with hysteresis |
| Oracle `HALTED` / recovered | broadcast once per state change to verified users |
| Daily digest (opt-in) | share-price delta — "your position earned while you slept" |

**Hysteresis (`services/bot/src/alertLogic.ts`).** Worsening is immediate:
crossing down through a threshold always alerts. Improving is sticky: the HF must
clear the threshold by 2% before the better band is reported. An HF oscillating
around 1.500 therefore produces exactly one message, not one per poll — asserted
by a test that walks a deliberately noisy series.

**Rate limit.** At most one message per chat per minute, *except* `urgent`, which
is the one case where being noisy is correct. A blocked user (send fails) is
logged and skipped; it never kills the loop.

Every alert carries a deep link to the relevant app view.

## Deploy

```sh
pnpm --filter @leontief/indexer migrate        # schema first — the bot refuses to boot without it
just bot                                       # local: migrate + run
PUBLIC_URL=https://bot.leontief.tech pnpm --filter @leontief/bot set-webhook
```

Secrets (`BOT_TOKEN`, `WEBHOOK_SECRET`) are in the D4 matrix — see
`docs/SECRETS.md`. The bot handle is published on the site footer so users can
check a fake against the real one.

## Not done here (deliberate)

No custody. No LLM — where the bot picks actions it is a scripted policy, and
Tier 1 does not pick actions at all. No group-chat trading features. No mainnet
automation. Signing on the user's behalf is Tier 2's problem, and only via a
user-revocable, on-chain-constrained delegated signer — see
`INTEGRATIONS/delegated-auth.md` before building any of it.
