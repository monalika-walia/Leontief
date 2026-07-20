# docs/MVP_TESTNET.md — MVP testnet run (3 wallets, our own pool)

Live dashboard: **<https://leontief.tech/performance>** (positions refresh live
from the Soroban RPC; the table below is the state as of 2026-07-19).

A real end-to-end run on Stellar testnet using Leontief's **own** vault +
mini-pool — no external Blend/Aquarius dependency. Three funded wallets wrap
restricted LEOD into ldLEOD, pledge it, and borrow USDC against it; two NAV
ticks then prove the shares keep accruing **while pledged**. Everything below is
verifiable on stellar.expert (testnet).

## Deployment (2026-07-19)

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
| Wrapped AUM (total assets value) | **$11,568.70** |
| Total shares | 11,229.90 ldLEOD |
| Share price | **1.030169** (from 1.000000 — two NAV ticks) |
| Utility ratio | **100%** — every share is pledged as collateral |
| Liquidations | 0 (all positions healthy) |

## Wallets

Ranked by collateral value. Cost basis = LEOD deposited × NAV at deposit, so
"unrealized" is genuine accrual, and differs by *when* each wallet entered.

| Wallet | Collateral (ldLEOD) | Value | Debt (USDC) | Health | Unrealized |
|---|---|---|---|---|---|
| `GCCDH7TXDEXCQZOCP7WTNV2MHSQOUSU736J6IRGZ5MPLJCNISGNMVYZD` | 5,104.50 | $5,258.50 | $1,500.00 | 2.98 | +$138.70 |
| `GCD5FOZUGNHEG7WHBMZTKD6FFG3LB5A3O3UVN7LLN5S5AV5OZVX6YPUB` | 3,062.70 | $3,155.10 | $2,200.00 | 1.22 | +$46.50 |
| `GA4PG5M3WIIYYXKOQFTAZ6IINT7TKSNHHAD62AL32F4S3Q4IRBCL5XMB` | 3,062.70 | $3,155.10 | $1,200.00 | 2.23 | +$77.10 |

Deposits: wallet 1 — 4,000 LEOD @ NAV 1.0209 then 1,000 @ 1.0362; wallet 2 —
2,000 @ 1.0209 then 1,000 @ 1.0362; wallet 3 — 3,000 @ 1.0362 (entered last,
so it has accrued the least). Health factors span **1.22 → 2.98**, exercising a
realistic spread rather than one uniform position.

## Transactions (newest first)

| Action | Wallet | Tx |
|---|---|---|
| nav_tick | oracle | `4882503ef91708cdd3c8a819ab342a772290846d21b5fe499d8688f1bbeeb17a` |
| borrow | `GA4PG5M3…5XMB` | `f6f0e8ae649d34600d80a12034fdcf1dd5833bbb0d348351d4ad4dc78a2f24a7` |
| supply_collateral | `GA4PG5M3…5XMB` | `a3cc24b782c9cdb6deabf952dc20d6f01e1ac7fed72ad1726a49b7aea44eaed4` |
| wrap | `GA4PG5M3…5XMB` | `ea457df762672f8b4e831347deb7b278740ae33fa5c598b55e9958d7f4de14c7` |
| **repay** | `GCCDH7TX…VYZD` | `9f825d05948999bd073364077212fee9816f82a5e7901ab7020d2a1629eac5b1` |
| supply_collateral | `GCCDH7TX…VYZD` | `a28fab15acfecdfd69fe4775665124ee5c4bd865995ff51e1f58d95e8644e2b7` |
| wrap | `GCCDH7TX…VYZD` | `4a1b223b0e1afb202c6dc3a1dfba53fbe414ace0311b0c4780ee259836172d8a` |
| borrow | `GCD5FOZU…YPUB` | `0911cf04491856e43f058c66adc36275d37e30590c19e2ed6421555591f4f11e` |
| supply_collateral | `GCD5FOZU…YPUB` | `57fc693fb96802a45567bd6b2207aa3ffef8e57edf096749d39648fcb2b3df22` |
| wrap | `GCD5FOZU…YPUB` | `213d31dcf9566ed094b381930a12438ee1c9a7be447ccbaca6ea89c069f8355d` |
| wrap | `GA4PG5M3…5XMB` | `d949809da5f50dcdded62c5e1931036d0d34ea18f6cad1a3bcf7266a0d57aacd` |
| supply_collateral | `GCCDH7TX…VYZD` | `46173ce0f16444a70f4e4cd77fcfda4db8a7e8ccdfab68302330e9dd6ff6d577` |
| borrow | `GCCDH7TX…VYZD` | `bc213ad650277731583a5fa5b468520f1dd28be627fff0fb6e9c3ef35caecf2c` |
| supply_collateral | `GA4PG5M3…5XMB` | `f1eac5d3810a20076a5cd46a0c0b3f6ee2d77e3c2ed52a042c69512660dc2ccb` |
| borrow | `GA4PG5M3…5XMB` | `a0d567f0b0e9cdb7a9739ea35dd650a32e7db39ae227df846c61159ed59477cb` |
| nav_tick | oracle | `c11c26fbff1b8c34a1f560d39a6d04319f7b4b1f4643edc69ad650153b2d04eb` |

Explorer: `https://stellar.expert/explorer/testnet/tx/<hash>`.
The **repay** above exercises the exit path, which is never pausable (CLAUDE.md).

> Signing keys are ephemeral testnet keys and live only in the gitignored
> `deploy.env` written by `scripts/setup_testnet.sh`.
