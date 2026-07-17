# docs/APP.md — the Leontief dApp (A2-P)

The pre-SCF testnet app. A non-developer can run the entire 5-beat thesis from a
browser against live testnet contracts; every figure is a chain read.

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
