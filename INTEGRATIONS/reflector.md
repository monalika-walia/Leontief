# INTEGRATIONS/reflector.md — Reflector live oracle feeds (X1)

**Researched & adversarially verified: 2026-07-17.** Reliability: **high** (every
contract ID below was confirmed live via `stellar-cli` against
`soroban-testnet.stellar.org`, and cross-checked against Stellar's oracle-providers
docs). Facts here are sourced, never from memory (CLAUDE.md).

## Decision

Wire the [oracle-adapter](../contracts/oracle-adapter) to a **live Reflector SEP-40
feed on testnet for a supported asset** (proving the live-oracle path end-to-end),
and **keep the mock for the RWA demo asset (LEOD)** — because no RWA feed exists on
testnet (see below). Mainnet plan: onboard a dedicated RWA NAV source before any
real asset is wrapped.

## Verified contract IDs

Source: <https://developers.stellar.org/docs/data/oracles/oracle-providers> +
live on-chain query.

| Feed | Network | Contract ID |
|---|---|---|
| Stellar DEX | testnet | `CAVLP5DH2GJPZMVO7IJY4CVOD5MWEFTJFVPD2YY2FQXOQHRGHK4D6HLP` |
| External CEX/DEX | testnet | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` |
| Fiat / FX | testnet | `CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W` |
| Stellar DEX | mainnet | `CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M` |
| External CEX/DEX | mainnet | `CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN` |
| Fiat / FX | mainnet | `CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC` |

## Interface (SEP-40)

Source: <https://github.com/reflector-network/reflector-contract>.

```rust
enum Asset { Stellar(Address), Other(Symbol) }
struct PriceData { price: i128, timestamp: u64 }
fn lastprice(asset: Asset) -> Option<PriceData>;
fn price(asset: Asset, timestamp: u64) -> Option<PriceData>;
fn decimals() -> u32;      // = 14 (live-verified, all three testnet feeds)
fn resolution() -> u32;    // = 300 s / 5-min heartbeat (live-verified)
fn base() -> Asset;        // Other("USD") on CEX/DEX + FX; a Stellar-asset SAC on the DEX feed
```

- `base()` on the testnet DEX feed = `Stellar(CA2E53VHFZ6YSWQIEIPBXJQGT6VW3VKWWZO555XKRQXYJ63GEBJJGHY7)`
  — a Stellar-asset SAC (believed USDC; **not independently resolved** — resolve
  on stellar.expert before relying on it).
- Pulse feeds are **free**, 5-min cadence, 24 h history retention.

## The RWA-feed gap (decisive)

Confirmed live: the testnet CEX/DEX feed carries **16 crypto majors + EURC**; the
FX feed carries **23 fiat currencies + XAU** (gold). Its `TRY` is Turkish Lira,
**not** USTRY. **No USDY / CETES / USTRY feed exists on testnet, and none was
identifiable on mainnet.** → keep the mock for RWAs; record the mainnet feed plan.

## Implementation

The Symbol→`Asset` gap is bridged by the **[`reflector-feed`](../contracts/reflector-feed)**
shim (not a change to the fail-closed core): the adapter calls its usual
`lastprice(Symbol)`, the shim maps the symbol to the registered Reflector `Asset`
(e.g. `Other("XLM")`), forwards to the live feed, and passes the XDR-identical
`PriceData` through un-rescaled. Wiring is one script:

```sh
source deploy.env && ./scripts/wire_reflector.sh   # deploy shim → map XLM → adapter.get_nav (live)
```

1. Shim maps `Symbol → Asset::Other(Symbol)`; adapter normalizes **14 dp → SCALE (10¹²)**
   (configured `source_decimals = 14`).
2. `max_age_secs` = cadence ×2.5 = **750 s**; `max_dev_bps` per calibration.
3. Deviation-breaker drill against the live feed (tighten bound → observe
   `DeviationExceeded` halt → re-arm via `accept_override`) — the script prints the
   exact commands; record tx hashes here.

## Open items / caveats (from adversarial review)

- ReflectorBeam's per-read `caller: Address` fee signature was **not** confirmed
  from the README — do not assert it; cite `reflector_beam.rs` if needed.
- Resolve the DEX-feed base SAC identity before asserting "USDC".

## Public docs page

<https://docs.leontief.tech/integrations/reflector>
