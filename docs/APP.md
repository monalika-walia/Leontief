# docs/APP.md — the Leontief dApp (A2-P)

The pre-SCF testnet app. A non-developer can run the entire 5-beat thesis from a
browser against live testnet contracts; every figure is a chain read.

## Live (testnet)

| Surface | URL |
|---|---|
| dApp | https://leontief-app.vercel.app |
| Guided 5-beat demo | https://leontief-app.vercel.app/demo |
| Landing | https://leontief-landing.vercel.app |
| Litepaper | https://leontief-landing.vercel.app/Litepaper.dc.html |

Deployed on Vercel (team `29projectslab`). The dApp bundle bakes in the live
testnet contract IDs; `/demo` signs with throwaway testnet keys, so all five
beats run with no wallet. Deploy how-to: `docs/DEPLOY.md`.

## Routes

| Route | What |
|---|---|
| `/vaults` | Markets table — NAV (with staleness/`HALTED` chip), share price, TVL, cap utilization, your ld-balance. |
| `/vaults/:id` | Wrap / unwrap surface + the **restriction demo** (beat 1, live): send 1 LEOD to a random address and watch the SEP-8 rejection. |
| `/borrow` | Mini-pool: supply / borrow / repay / withdraw, health-factor gauge, pre-flight post-HF preview. |
| `/positions` | Wrapped holdings + pool position + in-memory session tx log. |
| `/demo` | Guided 5-beat stepper (testnet + `VITE_DEMO_MODE=true` only). |

## Design system — "The Awake Ledger"

The app IS the awake (paper) state of the landing's dormant→awake concept.
Monochrome is law: risk/health is encoded by fill, weight, and motion — never
red/green. Ledger ruling behind content; dormant (ink, breathing) panels for
empty states; a status seal that pulses only while a tx is in flight. Tokens live
as CSS variables in `src/index.css`.

## Run

```sh
# 1) bring the stack up on testnet (writes deploy.env + demo keys)
just deploy-testnet

# 2) run the app (injects deploy.env → app/.env.local, then Vite)
just app            # → http://localhost:5173
```

Or manually: `./scripts/gen_app_env.sh && pnpm --filter @leontief/app dev`.

## Env

All `VITE_`-prefixed, generated from `deploy.env` by `scripts/gen_app_env.sh`;
validated with zod at boot (a missing var → full-screen config error, never a
blank app). Contract IDs + `VITE_DEMO_*` throwaway testnet keys. See
`app/.env.example`.

## Data & write flow

- **Reads**: `rpc.Server.simulateTransaction` via `src/lib/chain.ts`, wrapped in
  TanStack Query (12 s poll, 10 s stale). NAV surfaces its revert reason (Stale /
  Deviation / Unconfigured) for the fail-closed `HALTED` chip.
- **Writes**: one shared path (`src/lib/submitTx.ts`): build → simulate (map
  errors, stop early) → assemble fees → sign (wallet-kit or demo signer) → send →
  poll to SUCCESS → toast + explorer link + query invalidation + session log.
- **Errors**: `src/lib/errors.ts` maps every contract error code (per contract,
  since codes overlap) to calm human copy.

## Demo keys — guardrails

`/demo` signs with throwaway **testnet** secret keys from `deploy.env`
(`VITE_DEMO_*`). `src/lib/demoSigner.ts` throws unless the network passphrase is
testnet; the route only mounts when `VITE_DEMO_MODE=true` and the network is
testnet. Never reuse this pattern on mainnet.

## Agent treasury (A7)

`packages/sdk/examples/agent-treasury.ts` — an autonomous agent's treasury, run
as a policy loop against the live testnet deployment.

**What it is, honestly.** A plain Stellar keypair plus a scripted policy. There
is no LLM and no autonomy beyond the constants at the top of the file; "agent"
here means an unattended process with a wallet, nothing more. It exists because
agents earning stablecoin revenue are natural Leontief users — idle balances
should earn, and working capital should come from *borrowing against* the
position rather than liquidating it. It doubles as the SDK's dogfood test: the
script uses only the public surface, so anything it could not reach was an SDK
gap to fix first (it found two — SEP-41 balance/transfer reads, and
`maxBorrowForHealthFactor`).

**What it deliberately is not.** No Sybil/independence scoring, no revenue
underwriting, no credit scores, no x402 infrastructure, no new contract.
Leontief is collateralized; those mechanisms belong to uncollateralized-credit
protocols, which are future *integrators* of ld-shares rather than components of
Leontief.

### The loop

| Beat | What the policy does |
|---|---|
| 1 · Earn | Revenue lands as ordinary USDC. (x402 settles as ordinary USDC transfers too, so nothing is lost by using a faucet as the stand-in.) |
| 2 · Allocate | Idle USDC above the ceiling settles with the beta desk for the mirror asset → `wrap()` → ldLEOD → supplied as collateral. The treasury now earns while idle. |
| 3 · Yield | NAV / share price / treasury value printed each tick. |
| 4 · Working capital | Idle cash below the floor → `borrow()` against the ld-shares, never past **HF 1.6**. The position is not sold. |
| 5 · Repay & unwind | The next invoice repays the draw; `withdrawCollateral()` + `unwrap()` return the principal. |

### Guardrails (in code, not convention)

Testnet passphrase assertion (same pattern as the `/demo` signer) · hard HF floor
of **1.6**, re-asserted by pre-flight simulation before every draw, with no
override flag · per-draw notional cap · total position cap · bounded tick count,
so there is no unbounded automation. **This pattern requires human sign-off
before any mainnet use** — nothing here is audited for production.

### Run it

```sh
source deploy.env && ./scripts/agent_onboard.sh    # once — see below
source deploy.env && pnpm exec tsx packages/sdk/examples/agent-treasury.ts
```

Onboarding is a *separate script on purpose*: the mirror asset is a genuine
SEP-8 asset (`auth_required | auth_revocable`), so holding it needs a trustline
plus an issuer authorization. That is the issuer's compliance decision — not
something an autonomous treasury does for itself, and not something the SDK
should be able to do.

### Recorded run — testnet, 2026-08-02

Agent `GDIYIRHZBMTTEHDJAZ6P5N5A2SJAKF4TMUWTWJDC6QLYIUAA4KYGG2PN`, ten signed
transactions, ~90 s wall clock:

| Beat | Action | Tx |
|---|---|---|
| Earn | +250 USDC invoice | [`f874208c`](https://stellar.expert/explorer/testnet/tx/f874208c843a5405b6a370e244e6e210f5d9f7ed12f9f4c0e2b8f5bc278b3a62) |
| Allocate | 225 USDC settled to the desk | [`f21e33a5`](https://stellar.expert/explorer/testnet/tx/f21e33a5c1d352bb925910c4e228b9dbe3ea195fa296d128718cd321ddc89071) |
| Allocate | 225 LEOD delivered at par | [`1199782c`](https://stellar.expert/explorer/testnet/tx/1199782cb3f337f888b6547ccbdcc0d90ad301d70ba97789c14343fe2e999284) |
| Allocate | `wrap()` → 229.7024999 ldLEOD | [`ed485e24`](https://stellar.expert/explorer/testnet/tx/ed485e24fb3113efa13db3b38dd76a4a307d4a0d00661ccb7f4a4ab4fd16e953) |
| Allocate | `supplyCollateral()` | [`a7a20a14`](https://stellar.expert/explorer/testnet/tx/a7a20a1446dd3d88d44c286b4c50fca791f0aff9121f3c1466e64f80b97750b2) |
| Working capital | `borrow()` 100 USDC → **HF 1.914** | [`dd699cf1`](https://stellar.expert/explorer/testnet/tx/dd699cf1763953ddc20a93134ed5663bdbe670e61fc68313df5f878ff400060a) |
| Earn | +250 USDC invoice | [`29510617`](https://stellar.expert/explorer/testnet/tx/295106177ec68b2cb39ab42b57216b25c247c0c1440f2b54d8459a4f5faa5889) |
| Repay | `repay()` 100 USDC from revenue | [`db416582`](https://stellar.expert/explorer/testnet/tx/db416582c42f43558c1bc95c2e88b85836d0656fe2d7fc89b565dda45f421abb) |
| Unwind | `withdrawCollateral()` | [`f9117e9f`](https://stellar.expert/explorer/testnet/tx/f9117e9f90b6553c99b098316f23b8600548d8c0ecfacc5fd445b1790064f853) |
| Unwind | `unwrap()` → 224.9999998 LEOD | [`c0a6905f`](https://stellar.expert/explorer/testnet/tx/c0a6905f3c4cc6c928513bfa35d881b251d8e8c56f54e70b59aadbe8cb2b7e33) |

Two honest notes on those numbers:

- **Yield is not visible in a 90-second run.** The LEOD feed is a live Reflector
  price used as a *par-NAV proxy* (`INTEGRATIONS/reflector.md` — no RWA feed
  exists on Reflector testnet), so NAV moved from 1.000383… to 1.000764… during
  the run. The loop demonstrates the mechanism, not a yield magnitude.
- **225 LEOD in, 224.9999998 LEOD out.** The two-stroop shortfall is the
  spec's rounding discipline working as designed: floor→user on both the mint
  and redeem legs, so a round trip can never round in the user's favour.

A one-take screen recording of this run belongs here for the SCF submission;
`scripts/record_demo.md` covers the capture setup.

## MVP deviations from A2-P (tracked)

- **Plain CSS** (design tokens as CSS variables) instead of Tailwind — the
  monochrome ledger system is small and this avoids Tailwind version pitfalls.
- **Pool risk params** (LTV / liq-threshold / bonus) are compile-time constants
  in the deployed mini-pool with no getter, so they are mirrored 1:1 in
  `hooks.ts::POOL_PARAMS` rather than read on-chain.
- **Wrap quote** and **post-action HF** are client-side approximations (labelled
  `≈`) derived from `share_price` + NAV; the contract remains the source of truth
  and enforces exact amounts/bounds on submit.

Screenshots + the deployed Vercel URL go here for the SCF submission once the app
is deployed (Phase S).
