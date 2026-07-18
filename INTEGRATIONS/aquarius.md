# INTEGRATIONS/aquarius.md — Aquarius LP path (X3)

**Researched & adversarially verified: 2026-07-17.** Reliability: **high** (router
addresses are docs-current; **not yet blockchain-confirmed** — see caveat). Facts
sourced, never from memory (CLAUDE.md).

## Decision

Create an Aquarius **Stable Swap** pool pairing `ld-shares` (ldUSDY) with USDC on
testnet (both ≈ $1), with an add/remove-liquidity flow in the dApp. Fallback if the
Soroban AMM path is blocked on testnet: a classic **SDEX orderbook** demo,
documented as a fallback — not the product.

## Router addresses

Source: <https://docs.aqua.network> (router is the single entry point for swaps,
deposits, withdrawals, incl. multi-hop `swap_chained`).

| Network | Router contract ID |
|---|---|
| testnet | `CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD` |
| mainnet | `CBQDHNBFBZYE4MKPWBSJOPIYLW4SFSXAXUTSXJN76GNKYVYPCKWC6QUK` |

> ⚠️ The testnet router is **docs-current** ("updated February 2026, valid across
> testnet resets") but **was not blockchain-confirmed** in research. Stellar testnet
> is wiped 2–4×/year. **Run an on-chain smoke test** (resolve the contract / execute
> a testnet swap) and record the confirmed address + date in `deployments/*.json`
> before treating it as fact.

## Pool families & fees

| Family | Curve | Fees |
|---|---|---|
| Volatile | constant-product (Uniswap-v2) | 0.1% / 0.3% / 1% |
| Stable Swap | stableswap, up to 3 assets | customizable at creation |
| Concentrated | concentrated liquidity | — |

→ **Stable Swap** for ldUSDY/USDC.

## Creation & rewards

- **Permissionless** pool creation — anyone, any Stellar/Soroban asset pair.
- Pool creation cost: **300,000 AQUA**.
  (Source: <https://docs.aqua.network/user-guides/pools/creating-a-pool.md>)
- AQUA reward eligibility driven by on-chain AQUA/ICE voting (reward zone: voted
  above threshold + all assets whitelisted). Rewards are a mainnet concern.
  (Source: <https://docs.aqua.network/voting-and-rewards/aquarius-voting.md>)

## SDK

Official TS SDK **`@aquariusdefi/sdk` v0.2.0** (published 2026-07-13), depends on
`@stellar/stellar-sdk ^15.0.0`; verified to run on testnet (full on-chain swap +
friendbot funding). Python SDK: `pip install aquarius-sdk`.

```ts
// Router verified param names:
// deposit(user, tokens, pool_index /* u32 */, desired_amounts, min_shares)
// swap_chained(...) for multi-hop
```

> `init_standard_pool` / `init_stableswap_pool` signatures are **unsourced** — take
> them from the SDK's pool-creation helper at implementation time, do not guess. The
> `AquaToken/soroban-amm` repo is not public (404).

## Steps → accept when

1. `scripts/create_aqua_pool.sh` — ldUSDY/USDC Stable Swap pool + seed liquidity.
2. SDK `addLiquidity`/`removeLiquidity`; dApp "Provide liquidity" behind a flag.

**Accept when:** LP position opened+closed on testnet via the UI, tx hashes here.

## Public docs page

<https://docs.leontief.tech/integrations/aquarius>
