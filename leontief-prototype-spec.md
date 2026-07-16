# Leontief Prototype — Technical Specification v1.0
**For:** Monalika · Aditya · Vyom — 3–4 week sprint ending in the 5-beat SCF demo
**Scope:** Testnet prototype proving the full loop: restricted asset → wrapped share → borrow → yield-while-pledged → permissioned liquidation.

---

## 0 · Ground rules (SCF-driven, non-negotiable)

- **Repo ownership.** Fresh GitHub org; Monalika, Aditya, and Vyom are the committers of record from commit #1. This is a KYB/diligence requirement, not a formality.
- **Public by submission day.** Build in private if preferred; flip public with clean history before the application.
- **CI green always.** `fmt` + `clippy -D warnings` + tests on every PR. No direct pushes to `main`.
- **Everything reproducible.** One script deploys the whole system to a clean testnet account; one script runs the full demo.

## 1 · Stack, toolchain, repo layout

- **Contracts:** Rust + `soroban-sdk`, compiled to wasm. Pin the toolchain in `rust-toolchain.toml` and the SDK in `Cargo.lock` at kickoff (verify current stable versions with `stellar-cli` on day one — do not float versions mid-sprint).
- **Chain tooling:** `stellar-cli` for deploys, testnet RPC + friendbot for accounts.
- **Frontend:** existing React dApp (`leontief-frontend.jsx`) wired via `@stellar/stellar-sdk` + Freighter.

```
leontief/
├─ contracts/
│  ├─ vault/            # per-asset vault; IS the share token (SEP-41 surface)
│  ├─ vault-factory/
│  ├─ oracle-adapter/
│  ├─ mock-oracle/      # same read interface as Reflector (SEP-40 style)
│  └─ mini-pool/        # isolated borrow market + permissioned liquidation
├─ app/                 # React dApp
├─ scripts/             # setup_testnet.sh · demo.sh
├─ tests/               # cross-contract integration tests (beat_1..beat_5)
└─ .github/workflows/ci.yml
```

## 2 · Asset model & the demo asset

**Demo asset `LEOD`** ("Leontief Demo Bond"): a classic Stellar asset issued by a demo issuer account with **`auth_required` + `auth_revocable`** flags — i.e., a genuine SEP-8-class regulated asset. All contract interaction goes through its **Stellar Asset Contract (SAC)**.

- The issuer authorizes addresses via the SAC admin function `set_authorized(addr, true)`.
- **Beat 1 of the demo:** transfer LEOD to a *non-authorized* address → the SAC transfer **fails**. Then `set_authorized(vault, true)` → deposit succeeds. The restriction, and Leontief's answer to it, on screen.
- Real launch assets (USDY, Etherfuse CETES/USTRY) are also classic assets reachable via SAC; the same vault code path applies. CETES/USTRY are **weekly-rebase** (balance grows); USDY is **price-accrual** (NAV grows). The accounting below handles both without special-casing.

## 3 · Contract: `vault` (one instance per asset; deployed by factory)

**Design:** ERC-4626-style — the vault contract *itself* implements the SEP-41 token interface for its ld-share. One contract = share mint/burn is internal, no cross-contract token auth.

### Storage
| Key | Type | Notes |
|---|---|---|
| `Admin` | `Address` | factory at init; transferable (multisig later) |
| `Underlying` | `Address` | SAC of the wrapped asset |
| `Oracle` | `Address` | oracle-adapter |
| `AssetId` | `Symbol` | feed key, e.g. `"USDY"` |
| `TotalShares` | `i128` | |
| `Cap` | `i128` | max underlying units held |
| `Paused` | `bool` | |
| `Bal(Address)` / `Allow(Address,Address)` | `i128` | SEP-41 ledger |

### Core math (i128 throughout; checked ops only)
- Underlying amounts use the asset's native decimals (typically 7). Internal price scale `SCALE = 10^12`.
- **Total assets value** `V = SAC.balance(vault) × nav / 10^nav_dec`. Rebase assets: balance grows, nav ≈ const → V rises. Accrual assets: balance const, nav grows → V rises. One formula, both mechanics.
- **Inflation-attack defense (mandatory):** virtual offset `VIRT = 10^3` on both legs:
  - mint: `shares = received × (TotalShares + VIRT) / (V + VIRT)` — floor
  - redeem: `amount = shares × (V + VIRT) / (TotalShares + VIRT)` — floor
- **Balance-diff measurement:** `received = balance_after − balance_before` around the transfer-in; never trust the caller's `amount` for accounting (handles rebase ticks mid-tx).
- **Rounding rule:** every user-favorable path rounds down; anything protocol-owed rounds up. Property-tested (see §7).

### Interface (sketch — signatures binding, bodies not)
```rust
fn init(e: Env, admin: Address, underlying: Address, oracle: Address,
        asset_id: Symbol, cap: i128);
fn deposit(e: Env, from: Address, amount: i128) -> i128;   // returns shares
fn withdraw(e: Env, from: Address, shares: i128) -> i128;  // returns amount
fn share_price(e: Env) -> i128;        // SCALE-scaled underlying per share
fn total_assets_value(e: Env) -> i128; // in nav-quote units (USD, 7 dec)
// SEP-41 surface: transfer, transfer_from, approve, allowance, balance,
// decimals (7), name ("Leontief USDY Share"), symbol ("ldUSDY")
// Admin: set_cap, set_oracle, pause, unpause, transfer_admin
```
`deposit`/`withdraw`/`transfer*` all `require_auth(from)`. Admin fns `require_auth(admin)`.

### Events
`deposit(from, amount, shares)` · `withdraw(from, shares, amount)` · `cap_set` · `paused` · standard token events.

### Errors (typed, no panics on user input)
`NotInitialized · Paused · CapExceeded · ZeroAmount · InsufficientShares · OracleFailure · Unauthorized`

### Invariants (assert in tests)
1. `share_price` never decreases except via an accepted NAV decrease (no path may dilute).
2. Round-trip `deposit(x) → withdraw(all shares)` returns `≤ x` (never more).
3. Shares held in MiniPool appreciate identically to shares in a wallet (yield-passthrough is a *property*, not a feature).

## 4 · Contract: `vault-factory`

Deploys and registers vaults. Storage: `Registry: Map<Address /*underlying*/, Address /*vault*/>`, `Admin`, `VaultWasmHash`.
```rust
fn deploy_vault(e: Env, underlying: Address, oracle: Address,
                asset_id: Symbol, cap: i128) -> Address;
fn vault_of(e: Env, underlying: Address) -> Option<Address>;
fn set_wasm_hash(e: Env, hash: BytesN<32>);   // admin
```
Event: `vault_deployed(underlying, vault, asset_id)`.

## 5 · Contract: `oracle-adapter` (+ `mock-oracle`)

**Consumes** a SEP-40-style feed (Reflector on testnet where available; `mock-oracle` everywhere else — identical read interface, admin `set_price(asset, price, timestamp)`).

**Fail-closed policy — the answer to "what about the Blend oracle incident":**
```rust
fn get_nav(e: Env, asset_id: Symbol) -> NavData; // {nav: i128, dec: u32, ts: u64}
```
Reverts unless **all** hold:
1. `now − ts ≤ max_age[asset]` (default 25 h — NAV updates on real-world cadence, not per-block);
2. `|nav − last_accepted| / last_accepted ≤ max_deviation[asset]` (default 200 bps per update; T-bill NAVs do not gap);
3. feed configured and non-zero.
On success, `last_accepted` updates. On failure → `OracleFailure` → vault/pool operations that need pricing halt. **No silent fallback prices, ever.** Admin can re-arm after investigation (`accept_override` — emits a loud event; prototype-only escape hatch, documented as such).

<!-- ============================================================================
RECONSTRUCTION NOTE (2026-07-16): the source document for this file was truncated
from the middle of §6 onward when committed to the repo. Sections §6 (from "v0
charges no interest") through §10 below were reconstructed from the detailed,
untruncated per-section requirements in `leontief-build-prompts.md` (prompts C5,
C6, C7, C8, D1, and the weekly-gates footer) and `leontief-docs-hub.md`. The
numbers and signatures are consistent with those documents. Team: verify against
the original frozen spec and replace this block with the verbatim text.
============================================================================= -->

## 6 · Contract: `mini-pool` (isolated borrow market + permissioned liquidation)

Deliberately minimal — it exists so the liquidation demo is deterministic and Blend is not a dependency. **v0 charges no interest** (fixed 0% APR, stated openly in rustdoc — interest modeling is Blend's job at mainnet, not the prototype's).

### Storage
| Key | Type | Notes |
|---|---|---|
| `Admin` | `Address` | |
| `Collateral` | `Address` | the vault (ld-share token) |
| `Debt` | `Address` | SAC of the borrowable asset (test-USDC) |
| `Oracle` | `Address` | oracle-adapter |
| `Params` | struct | `ltv_bps: 8000 · liq_threshold_bps: 8500 · liq_bonus_bps: 500` |
| `Position(Address)` | struct | `{collateral_shares: i128, debt: i128}` — persistent |
| `Whitelist(Address)` | `bool` | permissioned liquidators — persistent |

### Valuation & health (unit trail documented in code)
- `coll_value = shares × vault.share_price / SCALE × nav / SCALE` (shares → underlying units → USD 7-dec).
- `health_factor = coll_value × liq_threshold_bps / 10_000 × SCALE / debt`; `i128::MAX` if debt = 0.

### Interface
```rust
fn init(e: Env, admin: Address, collateral: Address, debt: Address,
        oracle: Address, asset_id: Symbol);
fn supply_collateral(e: Env, from: Address, shares: i128);
fn withdraw_collateral(e: Env, from: Address, shares: i128); // post: hf ≥ SCALE
fn borrow(e: Env, from: Address, amount: i128);              // post: LTV ≤ ltv_bps
fn repay(e: Env, from: Address, amount: i128);               // NEVER pausable
fn health_factor(e: Env, user: Address) -> i128;
fn set_whitelist(e: Env, who: Address, ok: bool);            // admin
fn liquidate(e: Env, liquidator: Address, user: Address, repay: i128) -> i128; // returns seized shares
```
All state-changing fns `require_auth` the acting party.

### Permissioned liquidation
`liquidate` requires, in order: `require_auth(liquidator)` → whitelist membership (`NotWhitelisted` otherwise) → `hf < SCALE` → `repay ≤ debt / 2` (close factor). Then
`seize = repay × (10_000 + liq_bonus_bps) × SCALE / 10_000 / share_value` — **ceil on the protocol-side division, floor on the transfer-out**. Ordering: pull debt from liquidator (`transfer_from`) → reduce position → transfer shares out → event `liquidated(user, liquidator, repay, seize)`.

### Events
`supplied · withdrawn · borrowed · repaid · whitelist_set · liquidated`

### Errors
`NotInitialized · Unauthorized · NotWhitelisted · HealthyPosition · UnsafeWithdraw · LtvExceeded · CloseFactorExceeded · ZeroAmount · InsufficientCollateral · OracleFailure`

## 7 · Security checklist (every contract, every PR)

1. `require_auth` on every state-changing entry point; auth-failure test per fn.
2. i128 **checked** arithmetic only; overflow paths return typed errors, never panic.
3. Rounding direction: floor toward the user, ceil toward the protocol — property-tested round-trips (deposit→withdraw ≤ deposited; pool never under-compensated).
4. Inflation/donation attack tests in CI (virtual offset both legs; donation mints nothing, raises price for all).
5. Balance-diff measurement around every transfer-in.
6. Storage: instance = config only; persistent = user state with `extend_ttl` on every touch; no user state in temporary storage.
7. Oracle consumers handle `OracleFailure` by halting the pricing-dependent op — no fallback.
8. Exits (`withdraw`, `repay`) reachable while paused.
9. No `unwrap`/`expect`/`panic!` reachable from user input (clippy + grep gate).
10. Coverage ≥ 90 % lines on vault + mini-pool, enforced in CI.

## 8 · The 5-beat demo (integration tests mirror it 1:1)

| Beat | Name | Shows |
|---|---|---|
| 1 | `beat_1_restricted_transfer_fails` | LEOD transfer to non-authorized address fails (SEP-8 flags real); `set_authorized(vault)` → deposit path opens |
| 2 | `beat_2_wrap_mints_share` | deposit LEOD → vault mints ldLEOD at NAV; balance-diff + virtual-offset math on screen |
| 3 | `beat_3_share_moves_and_borrows` | ldLEOD transfers freely (SEP-41), supplied to mini-pool, USDC borrowed at 80 % LTV |
| 4 | `beat_4_nav_tick_raises_price_while_pledged` | oracle NAV tick → `share_price` rises for pledged shares identically to idle ones |
| 5a | `beat_5a_whitelisted_liquidation` | NAV drop → hf < 1 → whitelisted liquidator repays ≤ close factor, seizes shares + bonus |
| 5b | `beat_5b_unwhitelisted_rejected` | same distress, non-whitelisted caller → `NotWhitelisted` revert |

Each test's doc-comment is a one-line video caption. `scripts/demo.sh` executes the same beats against testnet via `stellar-cli`, printing tx hashes + stellar.expert links.

## 9 · Scripts & reproducibility

- `scripts/setup_testnet.sh`: fresh accounts (issuer, admin, alice, bob, liquidator, rando) via friendbot → issue LEOD with `auth_required|auth_revocable` → trustlines → deploy SAC → mock-oracle → adapter → factory → vault → test-USDC → mini-pool → whitelist liquidator → `set_authorized(vault, true)` → seed balances → write `deployments/testnet.json` + `deploy.env`.
- `scripts/demo.sh`: beats 1→5b via stellar-cli, tx hashes + explorer links, nonzero exit on any unexpected outcome.
- Both runnable end-to-end from a clean machine after `scripts/install_tools.sh`.

## 10 · Weekly gates

- **W1:** repo + CI + E-phase done; contracts C1–C2; through D1 beat 1 on testnet.
- **W2:** C3–C6 done; beats 2–3 green as integration tests.
- **W3:** full beat suite (1–5b) green in CI + on testnet; coverage gate ≥ 90 % passing.
- **W4:** demo video recorded; docs public; repo public with clean history.
