# docs/MVP_TESTNET.md — MVP testnet run (4 wallets, our own pool)

Live dashboard: **<https://leontief.tech/performance>** — reads positions in
real time from the Soroban RPC. The table below is a point-in-time snapshot
(2026-07-20).

A real end-to-end run on Stellar testnet using Leontief's **own** vault +
mini-pool — no external Blend/Aquarius dependency. Four funded wallets wrap
restricted LEOD into ldLEOD, pledge it, and borrow USDC against it; NAV ticks
prove the shares keep accruing **while pledged**, and a repay proves the exit
path. Everything below is verifiable on stellar.expert (testnet).

## How the dashboard is real-time

Two independent read paths, so the numbers are always genuine chain state:

1. **Primary — `/api/performance`** (Vercel serverless function,
   `landing/api/performance.js`): reads `share_price`, totals, and each wallet's
   `position` + `health_factor` server-side via `simulateTransaction` and returns
   JSON. The page polls it every 12 s. No client bundle, no keys.
2. **Fallback — client-side reads**: if the API isn't reachable, the page loads
   `@stellar/stellar-sdk` and runs the same reads straight from the browser.

A baked snapshot paints instantly; whichever read path answers first replaces it
and flips the status to **live · updated Ns ago**. Only per-wallet **cost basis**
(LEOD deposited × NAV at deposit, for the unrealized-gain column) is a recorded
constant — the chain does not store it. Everything else is read live.

## Deployment (2026-07-20)

| Contract | ID |
|---|---|
| Vault (ldLEOD) | `CB64EHOFGTWH2USSZP3PL2B66XJ4KD6A6C3SFXKPNTEO3NCIZFZWLHUS` |
| Mini-pool | `CCX7Z6TGAVAKOYMS3QAHD4VZHQB2QCC2XVQ4UWBZFSOX4HHDBB45EQ54` |
| Oracle adapter | `CC624XAUEW2MYLGRQ6LMLVJQWF3ER3FQXUW2UQIJ7N2JRIDBZTGBH7NC` |
| USDC (SAC) | `CBZ6PBCQUQPAJKMC75PPUSVUBXZD3SNEZMYWHWHMKMYOT5H25SEDUE6Z` |
| LEOD (SAC, SEP-8 restricted) | `CDE5ZRPD2SJCUZIKEVM546Y25YIER35WYKVWICQFDW3I2ZHL2MLD4AOW` |
| Mock oracle | `CBKHRAA4GJPOP537MNZ5EVYPW5PSKV3S2R6MQPXP7MTWOJFXQMXXHSYG` |

## Pool

| Metric | Value |
|---|---|
| Wrapped AUM (total assets value) | **$14,310.00** |
| Total shares | 13,782.15 ldLEOD |
| Share price | **1.038300** (from 1.000000 — successive NAV ticks) |
| Utility ratio | **100%** — every share pledged as collateral |
| Liquidations | 0 |

## Wallets (ranked by collateral value)

| Wallet | Collateral (ldLEOD) | Value | Debt (USDC) | Health | Unrealized |
|---|---|---|---|---|---|
| `GCCDH7TXDEXCQZOCP7WTNV2MHSQOUSU736J6IRGZ5MPLJCNISGNMVYZD` | 5,104.50 | $5,300.00 | $2,500.00 | 1.80 | +$180.20 |
| `GCD5FOZUGNHEG7WHBMZTKD6FFG3LB5A3O3UVN7LLN5S5AV5OZVX6YPUB` | 3,062.70 | $3,180.00 | $1,500.00 | 1.80 | +$71.40 |
| `GA4PG5M3WIIYYXKOQFTAZ6IINT7TKSNHHAD62AL32F4S3Q4IRBCL5XMB` | 3,062.70 | $3,180.00 | $1,200.00 | 2.25 | +$102.00 |
| `GB7XND6M7PLZEO5JSKXYFUOTA4TW6DIKJYFV42VRETWTZHFAI3JOKLKZ` | 2,552.25 | $2,650.00 | $1,000.00 | 2.25 | +$0.00 |

The 4th wallet entered last (at NAV 1.06) with no tick since, so its unrealized
gain is ~$0 — the basis math working: gains reflect *when* a wallet entered.
Health factors span **1.80 → 2.25**.

## Transactions (newest first)

| Action | Wallet | Tx |
|---|---|---|
| borrow | `GB7XND6M…KLKZ` | `c45eb92bc5420bf7e1c7056b6e38f1e5f6047c5997f0098c57cd152c61e3ed6c` |
| supply_collateral | `GB7XND6M…KLKZ` | `894338cca6b7e05742932486427d7ede14599655d72113c718e3721023e5ec76` |
| wrap | `GB7XND6M…KLKZ` | `419a916391a1c9758fc06d8bf8b084335f1bd90a505c700758e1822d714d0989` |
| borrow | `GCCDH7TX…VYZD` | `4948cea71ed20d560ae8bac050e8308ec585e29ebd59bb87750a02fe68609990` |
| nav_tick | oracle | `74fa50f84dfaa7924028aa49d0c892283f62da023066cae818fa4a78443c5e0e` |
| repay | `GCD5FOZU…YPUB` | `f9653767146dd9273ef0d728dbe6aa5ed818249dbe25ceaaf6c8abc44195f7e2` |
| nav_tick | oracle | `4882503ef91708cdd3c8a819ab342a772290846d21b5fe499d8688f1bbeeb17a` |
| borrow | `GA4PG5M3…5XMB` | `f6f0e8ae649d34600d80a12034fdcf1dd5833bbb0d348351d4ad4dc78a2f24a7` |
| supply_collateral | `GA4PG5M3…5XMB` | `a3cc24b782c9cdb6deabf952dc20d6f01e1ac7fed72ad1726a49b7aea44eaed4` |
| wrap | `GA4PG5M3…5XMB` | `ea457df762672f8b4e831347deb7b278740ae33fa5c598b55e9958d7f4de14c7` |
| repay | `GCCDH7TX…VYZD` | `9f825d05948999bd073364077212fee9816f82a5e7901ab7020d2a1629eac5b1` |
| supply_collateral | `GCCDH7TX…VYZD` | `a28fab15acfecdfd69fe4775665124ee5c4bd865995ff51e1f58d95e8644e2b7` |
| wrap | `GCCDH7TX…VYZD` | `4a1b223b0e1afb202c6dc3a1dfba53fbe414ace0311b0c4780ee259836172d8a` |
| borrow | `GCD5FOZU…YPUB` | `0911cf04491856e43f058c66adc36275d37e30590c19e2ed6421555591f4f11e` |
| supply_collateral | `GCD5FOZU…YPUB` | `57fc693fb96802a45567bd6b2207aa3ffef8e57edf096749d39648fcb2b3df22` |
| wrap | `GCD5FOZU…YPUB` | `213d31dcf9566ed094b381930a12438ee1c9a7be447ccbaca6ea89c069f8355d` |

Explorer: `https://stellar.expert/explorer/testnet/tx/<hash>`. The **repay**
exercises the never-pausable exit path (CLAUDE.md).

> Signing keys are ephemeral testnet keys, only in the gitignored `deploy.env`.
