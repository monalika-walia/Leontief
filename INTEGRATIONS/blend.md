# INTEGRATIONS/blend.md — Blend pool with ld-share collateral (X2)

**Researched & adversarially verified: 2026-07-17.** Reliability: **high** (all
addresses confirmed against `blend-utils` `testnet.contracts.json` + docs.blend.capital).
Facts sourced, never from memory (CLAUDE.md).

## Decision

Stand up a real **Blend V2** testnet pool that accepts `ld-shares` (ldUSDY) as
collateral, borrowing USDC — proving the collateral path in a production
money-market. The [mini-pool](../contracts/mini-pool) is then demo/liquidation-drill
only.

## Verified testnet addresses (Blend V2)

Source: `blend-utils` `testnet.contracts.json`; <https://docs.blend.capital>.

| Component | Contract ID |
|---|---|
| Pool Factory V2 | `CDV6RX4CGPCOKGTBFS52V3LMWQGZN3LCQTXF5RVPOOCG4XVMHXQ4NTF6` |
| Backstop V2 | `CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA` |
| BLND token | `CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF` |
| USDC token | `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU` |
| Comet BLND:USDC LP (backstop token) | `CA5UTUUPHYL5K22UBRUVC37EARZUGYOSGK3IKIXG2JLCC5ZZLI4BDWDM` |
| Comet factory | `CDX2TKELFKHP2MWISDCXWWZ73CL7F57GHYRJAWJWNOTLNJNNM7XLT4JY` |
| Emitter | `CC3WJVJINN4E3LPMNTWKK7LQZLYDQMZHZA7EZGXATPHHBPKNZRIO3KZ6` |
| Reference pool (TestnetV2) | `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF` |

## The oracle interface Blend consumes (the crux)

A Blend pool calls its oracle via **SEP-40**, invoking assets as
`Asset::Stellar(address)`:

```rust
fn lastprice(asset: Asset) -> Option<PriceData>;   // PriceData { price: i128, timestamp: u64 }
fn decimals() -> u32;
```

→ Build a thin **`blend-price-adapter`** exposing exactly this, sourcing
`vault.share_price × oracle-adapter.get_nav` (the composable price of one ld-share)
under the **same fail-closed policy**. If Leontief halts, Blend sees stale → its
protections engage.

> ⚠️ **A pool's oracle cannot be changed after creation** (docs.blend.capital,
> selecting-an-oracle). The adapter choice is irreversible per pool — call out in
> the mainnet runbook.

## Reserve config & rates

`ReserveConfig`: `c_factor` (≈LTV), `l_factor`, `util`, `max_util` — all **7-decimal**.
IR params `r_base/r_one/r_two/r_three` = `R0/R1/R2/R3`, 7-decimal. ldUSDY reserve
launches with a conservative **`c_factor` = 7000 (70%)**.

> The exact slope semantics / tier breakpoints of `r_one..r_three` are in the Blend
> **whitepaper**, not the tutorial pages — **not asserted here**; pin from the
> whitepaper before mainnet.

## Backstop activation

Backstop token = **BLND:USDC 80:20 Comet LP**. Activation threshold: **product
constant 200,000** (~50,000 LP tokens sufficient). Testnet: faucet BLND/USDC → mint
Comet LP → fund backstop past threshold → pool Setup→Active.

## SDK

`@blend-capital/blend-sdk` **v3.3.0** (pin exactly; re-verify at build — `latest` is
a moving target). Actions submit as a `requests` array:

```ts
// RequestType: Supply=0, Withdraw=1, SupplyCollateral=2, WithdrawCollateral=3,
//              Borrow=4, Repay=5, … DeleteLiquidationAuction=9
type Request = { request_type: RequestType; address: string; amount: bigint };
// pool.submit({ from, spender, to, requests })   // or submit_with_allowance
```

## Steps → accept when

1. Deploy pool via factory: ldUSDY reserve (`c_factor` 7000) + `blend-price-adapter` oracle.
2. Meet backstop threshold (faucet + Comet LP), activate.
3. `scripts/deploy_blend_pool.sh`; supply-collateral + borrow-USDC via SDK; dApp
   "Borrow on Blend" behind a flag.

**Accept when:** end-to-end borrow against ld-share in a live Blend testnet pool,
tx hashes recorded here.

## Caveats (adversarial review dropped these as uncited)

- `mint-lp.ts`/`fund-backstop.ts` arg convention (0=BLND/1=USDC/2=balanced) — re-source from `blend-utils` scripts.
- Backstop `k = x^0.8·y^0.2` formula — cite whitepaper or omit.

## Public docs page

<https://docs.leontief.tech/integrations/blend>
