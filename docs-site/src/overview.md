# Leontief

**Leontief is an adapter layer, not another lending protocol.**

It converts tokenized real-world assets on Stellar — restricted, rebasing,
price-accruing — into composable, yield-passing **ld-share** vault tokens that
move through Blend, Aquarius, and any Soroban protocol, with a fail-closed NAV
oracle and **permissioned liquidation** designed for regulated assets.

## Live (testnet)

| Surface | Link |
|---|---|
| dApp — wrap, borrow, stats, liquidator console, issuer panel | <https://leontief-app.vercel.app> |
| **Guided 5-beat demo** (no wallet needed) | <https://leontief-app.vercel.app/demo> |
| Landing | <https://leontief-landing.vercel.app> |
| Litepaper | <https://leontief-landing.vercel.app/Litepaper.dc.html> |
| Public metrics (the utility-ratio KPI) | <https://leontief-app.vercel.app/stats> |
| Backend API | <https://leontief-api.onrender.com/health> |
| Source | <https://github.com/monalika-walia/Leontief> |

Contract addresses: [Addresses (testnet)](addresses.md) — generated from the
committed deployment registry and verified in CI.

## The five beats

The whole thesis, live on-chain (each is also an integration test and a button
in [/demo](https://leontief-app.vercel.app/demo)):

1. **Restricted transfer fails** — LEOD is a genuine SEP-8 asset
   (`auth_required | auth_revocable`); sending it to a stranger reverts.
   Authorizing the vault opens the door.
2. **Wrap mints ldLEOD at NAV** — balance-diff measured, virtual-offset math.
3. **The share moves freely and borrows** — SEP-41 transfer, then USDC drawn at
   80% LTV against pledged shares.
4. **Yield while pledged** — a NAV tick raises `share_price` for locked
   collateral identically to idle shares.
5. **Permissioned liquidation** — a whitelisted liquidator repays and seizes at
   a 5% bonus (5a); an un-whitelisted caller is refused (5b).

*Demo video: recorded per [`scripts/record_demo.md`](https://github.com/monalika-walia/Leontief/blob/main/scripts/record_demo.md) — link lands here with the SCF submission.*

## Verification posture

- 98+ tests: unit · property (proptest) · integration beats · golden vectors
  (byte-for-byte vs a committed Python-`decimal` generator) · two fuzz targets.
- Coverage gate ≥90% lines on the funds-holding contracts (currently ~95.8%).
- Every threat row in the [threat model](architecture.md) maps to a named test —
  see [Security & Test Tie-out](security-testing.md). Zero untested rows.
