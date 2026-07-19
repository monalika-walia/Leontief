# docs/MVP_TESTNET.md — MVP testnet run (2 users, our own pool)

Live snapshot: **<https://leontief.tech/performance>** (positions refresh live from
the Soroban RPC; baked snapshot below is the state as of 2026-07-19).

This records a real end-to-end run on Stellar testnet using Leontief's **own**
vault + mini-pool (no external Blend/Aquarius dependency) with two funded users.
All addresses/hashes are verifiable on stellar.expert (testnet).

## Deployment (fresh, 2026-07-19)

| Contract | ID |
|---|---|
| Vault (ldLEOD) | `CB64EHOFGTWH2USSZP3PL2B66XJ4KD6A6C3SFXKPNTEO3NCIZFZWLHUS` |
| Mini-pool | `CCX7Z6TGAVAKOYMS3QAHD4VZHQB2QCC2XVQ4UWBZFSOX4HHDBB45EQ54` |
| Oracle adapter | `CC624XAUEW2MYLGRQ6LMLVJQWF3ER3FQXUW2UQIJ7N2JRIDBZTGBH7NC` |
| USDC (SAC) | `CBZ6PBCQUQPAJKMC75PPUSVUBXZD3SNEZMYWHWHMKMYOT5H25SEDUE6Z` |
| LEOD (SAC, SEP-8 restricted) | `CDE5ZRPD2SJCUZIKEVM546Y25YIER35WYKVWICQFDW3I2ZHL2MLD4AOW` |
| Mock oracle | `CBKHRAA4GJPOP537MNZ5EVYPW5PSKV3S2R6MQPXP7MTWOJFXQMXXHSYG` |

## Users

| User | Address | Wrapped | Collateral (ldLEOD) | Debt (USDC) | Health |
|---|---|---|---|---|---|
| Alice | `GCCDH7TXDEXCQZOCP7WTNV2MHSQOUSU736J6IRGZ5MPLJCNISGNMVYZD` | 4,000 LEOD | 4,083.60 | 2,000.00 | 1.76 |
| Bob | `GA4PG5M3WIIYYXKOQFTAZ6IINT7TKSNHHAD62AL32F4S3Q4IRBCL5XMB` | 2,000 LEOD | 2,041.80 | 900.00 | 1.96 |

Pool: wrapped AUM **$6,217.20**, utility ratio **100%** (both fully pledged),
share price **1.014987** (rose from 1.0 after a NAV tick — collateral accrued
+1.50% **while pledged**, the core value prop).

## Transactions (testnet)

| Action | Who | Tx |
|---|---|---|
| wrap LEOD → ldLEOD | Bob | `d949809da5f50dcdded62c5e1931036d0d34ea18f6cad1a3bcf7266a0d57aacd` |
| supply collateral | Alice | `46173ce0f16444a70f4e4cd77fcfda4db8a7e8ccdfab68302330e9dd6ff6d577` |
| borrow USDC | Alice | `bc213ad650277731583a5fa5b468520f1dd28be627fff0fb6e9c3ef35caecf2c` |
| supply collateral | Bob | `f1eac5d3810a20076a5cd46a0c0b3f6ee2d77e3c2ed52a042c69512660dc2ccb` |
| borrow USDC | Bob | `a0d567f0b0e9cdb7a9739ea35dd650a32e7db39ae227df846c61159ed59477cb` |
| NAV tick (+1.5%) | Admin | `c11c26fbff1b8c34a1f560d39a6d04319f7b4b1f4643edc69ad650153b2d04eb` |

Explorer: `https://stellar.expert/explorer/testnet/tx/<hash>`.

> Signing keys for these accounts live only in the gitignored `deploy.env` from
> the `scripts/setup_testnet.sh` run; they are ephemeral testnet keys.
