# @leontief/autopilot — policy-delegated Autopilot (A8 Tier 2)

A multi-user policy loop that can act on a user's position within limits they
set. **Off by default. Testnet only. Not audited.**

> **Mainnet Autopilot requires an audit and human sign-off. Full stop.**
> Nothing in this service is production-ready, and the engine refuses to start on
> any network but testnet.

This is the only thing in the repo that signs on a user's behalf. Read
`INTEGRATIONS/delegated-auth.md` and DECISIONS #11 before changing anything here.

## What the grant actually is (Path B)

The decision gate resolved to **Path B**: a session keypair added as an
additional signer on the user's own classic account.

Being honest about that, because it matters:

- A classic Stellar signer is **not scope-limited**. Weight and thresholds decide
  *how much* authority it has, not *which contracts* it may touch. Within the
  account's medium threshold it could sign other things.
- The ceremony sets master weight 2 / medium 1 / high 2, so the session key can
  invoke contracts but can **never** add or remove signers or change thresholds.
  No lockout, no privilege escalation.
- The on-chain layer therefore contributes exactly one guarantee — and it is the
  one that matters most: **revocation is unilateral and instant.** The user
  removes the signer and the capability is gone, whatever this engine believes.
- **The engine-side policy is the real leash.** Which makes
  [`src/policy.ts`](src/policy.ts) the trust boundary: pure, no I/O, fails closed,
  and exhaustively tested.

Path A (on-chain policy signers) is not available to us today — OpenZeppelin's
shipped spending-limit policy panics on any function name that is not `transfer`,
so it cannot meter `borrow`/`repay`, and an HF floor depends on mini-pool state.
Both would need a custom, audited Soroban policy contract. The upgrade path is
recorded in `INTEGRATIONS/delegated-auth.md`.

## The leash

| Constraint | Where |
|---|---|
| Allowed contract IDs (user's vault + mini-pool) | engine |
| Per-action notional cap | engine |
| **Daily** notional cap | engine — a per-action cap alone is trivially drained by repetition |
| **HF floor 1.6, no override** | engine, asserted against a pre-flight simulation |
| Expiry ≤ 30 days | engine + enforced server-side on the grant |
| Per-user cooldown, max actions per cycle | engine |
| Global kill switch (`AUTOPILOT_KILL`) | engine |
| Revocation | **on-chain**, one `set_options` |

## Order of operations (this *is* the safety property)

```
read state → strategy proposes → PRE-FLIGHT SIMULATE post-action HF
           → checkPolicy → execute → log → notify
```

The floor is asserted against what the chain says would happen, not an estimate.
A read that fails means the engine refuses rather than guesses — fail-closed,
matching the oracle policy in spec §5.

## Strategies (opt-in, default `digest-only`)

- **`digest-only`** — reports, never acts. The default, and what a user gets if
  they change nothing.
- **`hf-guard`** — repays from idle USDC to pull a slipping position back up.
  Pairs with the Tier-1 alerts: rather than waking someone at 3am, it fixes the
  thing the alert would have been about. Never borrows, never sells collateral,
  never repays more than the user holds idle.
- **`idle-sweep`** — wraps mirror-asset the user **already holds** into
  ld-shares. Deliberately narrower than A7's single-user loop, which *acquired*
  the asset first: buying something on a user's behalf is a much larger
  permission than wrapping their own balance.

## Run

```sh
docker compose up -d postgres
AUTOPILOT_FLAG=true \
AUTOPILOT_SESSION_KEYS="G...:S...,G...:S..." \
  pnpm --filter @leontief/autopilot dev
```

Without `AUTOPILOT_FLAG=true` the process prints why it is doing nothing and
exits. Session secrets are read from the engine's environment — never from
Postgres, and never anywhere the Telegram bot can reach.

## Test

```sh
pnpm --filter @leontief/autopilot test                 # policy + strategies
LEONTIEF_DB=1 pnpm --filter @leontief/autopilot test   # + engine vs real Postgres
./scripts/check_autopilot_gated.sh                     # the guardrail gate
```

The engine suite asserts what makes this safe to switch on: executes in-policy,
refuses and records when simulation fails, refuses below the floor, refuses over
cap, stops on the kill switch, and loses capability entirely once a grant is
revoked — including recording `tx_bad_auth` when the chain rejects a signature
the user has already revoked on-chain.
