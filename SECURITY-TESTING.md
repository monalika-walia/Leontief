# SECURITY-TESTING.md — threat → verification tie-out (Audit Bank hand-off)

Every threat row from `leontief-docs-hub.md` §03 maps to at least one concrete
verification: a **unit/integration test**, a **property test**, a **fuzz target**,
or a **testnet drill**. Zero rows are "untested". This file is the audit-readiness
artifact (prompt C8).

Test paths are relative to the repo root. Run everything with `just check`
(fmt + clippy + tests + coverage ≥90%); the deep property/fuzz passes run in
`.github/workflows/nightly.yml`.

## Threat coverage

| # | Threat (docs-hub §03) | Vector | Control | Verified by |
|---|---|---|---|---|
| 1 | Share inflation attack | first-deposit front-run + donation | virtual offset (10³) both legs; zero-share mints revert | `contracts/vault/src/test.rs::inflation_attack_spec_scenario_loss_below_1e6th`, `::inflation_attack_with_huge_donation_costs_the_attacker`; property `contracts/vault/tests/prop.rs::inflation_attack_unprofitable`; fuzz `fuzz_vault_sequences` |
| 2 | Accounting drain | rounding-direction abuse | floor→user / ceil→protocol; balance-diff | property `contracts/vault/tests/prop.rs::vault_invariants_hold_over_sequences` (Σ withdrawn ≤ Σ deposited+donations); `contracts/mini-pool/tests/prop.rs::liquidation_rounding_never_undercompensates`; golden `tests/tests/golden.rs` |
| 3 | Oracle manipulation / staleness | bad or stale NAV | fail-closed adapter: staleness + 200 bps/update deviation, halt-not-guess | `contracts/oracle-adapter/src/test.rs` (age boundary ±1, deviation boundary both directions, missing/zero/negative price, override); property `contracts/oracle-adapter/tests/normalization_prop.rs`; drill D-1 below |
| 4 | Rebase timing games | deposit around a rebase tick | balance-diff measurement at transfer boundaries | `contracts/vault/src/test.rs::deposit_uses_balance_diff_not_caller_amount`, `::rebase_tick_then_withdraw_all_captures_growth`; golden `rebase_then_withdraw_all` |
| 5 | Unlawful collateral seizure | non-whitelisted liquidator | whitelist gate + rejection path | `contracts/mini-pool/src/test.rs::unwhitelisted_liquidator_rejected`; integration `tests/tests/beats.rs::beat_5b_unwhitelisted_rejected` |
| 6 | Issuer freeze / clawback | SEP-8 `auth_revocable` action | per-vault isolation; pause covers deposits only; **exits never pause** | `contracts/vault/src/test.rs::withdraw_works_while_paused`; `contracts/mini-pool/src/test.rs::repay_works_during_oracle_halt_but_borrow_does_not`; integration `beat_1_restricted_transfer_fails` (real SEP-8 flags) |
| 7 | Admin key compromise | multisig member loss | 2-of-3 hardware multisig, two-step admin transfer | `contracts/vault/src/test.rs::two_step_admin_transfer`, `::admin_ops_require_admin_auth`; testnet rehearsal D3 (docs/MULTISIG.md, pending) |
| 8 | Governance rug perception | fee/param abuse | hard-coded caps, event log, tokenless | `contracts/vault/src/test.rs::set_cap_validates_and_applies`; param-change events asserted across contracts; (fee module ships OFF at mainnet, spec §02) |
| 9 | Frontend phishing | clone sites | contract IDs pinned in docs; addresses from env only | out of contract scope — `deployments/*.json` registry (D2) + `docs/ADDRESSES.md`; landing/app read IDs from env, never hardcoded |

## Invariants (docs-hub §03) → property/golden coverage

| Invariant | Verified by |
|---|---|
| share_price non-decreasing absent an accepted NAV decrease | `vault::prop::vault_invariants_hold_over_sequences` (b); `fuzz_vault_sequences` |
| Σ user claims ≤ vault holdings + dust | `vault::prop` solvency check; `fuzz_vault_sequences` (a) |
| deposit→withdraw round-trip ≤ deposited | `vault::src::test::round_trip_returns_leq_deposited`; property (a) |
| pledged shares accrue identically to idle shares | `beats.rs::beat_4_nav_tick_raises_price_while_pledged` |
| pool never under-compensated by rounding | `mini-pool::prop::liquidation_rounding_never_undercompensates`; `fuzz_pool_sequences`; golden `seize_repay_*` |

## Fuzz targets (`fuzz/`, cargo-fuzz, nightly)

| Target | Drives | Asserts |
|---|---|---|
| `fuzz_vault_sequences` | deposit/withdraw/transfer/donation + NAV walks (≤200 bps) | invariants (a) Σ-conservation, (b) monotone price, (e) supply conservation, donation mints nothing |
| `fuzz_pool_sequences` | borrow/repay/supply/liquidate + NAV walks with fail-closed re-arm | LTV post-condition, debt-monotone on repay/liquidate, liquidator never over-compensated |

Run locally: `just fuzz 60` (60 s/target) or `cd fuzz && cargo +nightly fuzz run <target>`.
Nightly CI runs 1 h per target.

## Testnet drills (recorded before each tranche report)

| ID | Drill | Expected | Status |
|---|---|---|---|
| D-1 | Oracle deviation breaker: tighten bound, feed a jump, observe halt, override to restore | `get_nav` reverts `DeviationExceeded`; `override_accepted` event fires | scripted in D1 (`scripts/`), pending testnet run |
| D-2 | Vault pause: pause deposits, confirm withdraw still succeeds | deposit `Paused`, withdraw OK | pending |
| D-3 | Liquidation both paths (whitelisted OK, un-whitelisted rejected) | matches beats 5a/5b on testnet | pending |
| D-4 | Fresh-account full redeploy via `setup_testnet.sh` | clean end-to-end deploy | pending |

## Coverage gate

`cargo llvm-cov --package vault --package mini-pool --fail-under-lines 90` — the
two funds-holding contracts. Current: **95.8% lines** (CI-enforced, HTML artifact
uploaded per run).
