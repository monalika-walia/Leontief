# Leontief — Claude Code Build Prompts v2.0
**Full-detail edition: contracts, integrations, tooling, infra.**
Rules of use: **one prompt = one PR.** Paste into Claude Code at repo root. Prompts assume `leontief-prototype-spec.md` + `leontief-docs-hub.md` are committed — every session reads them first. Red CI never merges. Spec deviations require a human-authored `DECISIONS.md` entry (this is also the SCF AI-disclosure discipline).

**Phases:** E (environment) → C (contracts) → D (deploy/infra) → A (app & services) → X (ecosystem integrations) → S (ship).
**Ownership:** Track A = Monalika (C3, C4, C7, C8) · Track B = Aditya (C1, C2, C5, C6, X1–X3) · Track C = Vyom (E1–E2, D1–D4, A1–A6, S1–S3). C7 pairs A+B.

---

## CLAUDE.md v2 — commit at repo root before anything else

```markdown
# CLAUDE.md — Leontief repo rules (binding for every session)
Read `leontief-prototype-spec.md` (FROZEN) and `leontief-docs-hub.md` before any change.

## Network facts (stable — do not "update" these)
- Testnet RPC: https://soroban-testnet.stellar.org
- Testnet Horizon: https://horizon-testnet.stellar.org · Friendbot: https://friendbot.stellar.org
- Testnet passphrase: "Test SDF Network ; September 2015"
- Mainnet passphrase: "Public Global Stellar Network ; September 2015"
- Mainnet RPC: provider chosen in DECISIONS.md (never hardcode; read from env)

## Non-negotiables
- Rust + soroban-sdk pinned (rust-toolchain.toml + Cargo.lock). Never bump unasked.
- i128 checked math only. Rounding: floor→user, ceil→protocol. VIRT=10^3 both mint/redeem legs. SCALE=10^12.
- Balance-diff measurement around every transfer-in. No trusting caller amounts.
- Oracle policy FAIL-CLOSED (spec §5). No fallback prices, no silent staleness.
- require_auth on every state-changing entry point. Typed errors; no panic/unwrap reachable from user input.
- Storage discipline: instance storage = config/admin only; persistent = balances/positions/registry;
  temporary = nothing user-owned. Every persistent write path calls extend_ttl (threshold/extend values
  from constants.rs; verify current network TTL limits with stellar-cli at kickoff and record).
- Exits (withdraw/repay) are NEVER pausable. Do not "improve" this.
- Every PR: `just check` green (fmt, clippy -D warnings, tests, coverage gate ≥90% vault+mini-pool).
- Version-volatile ecosystem facts (SDK versions, Reflector feed IDs, Blend params) live in
  `INTEGRATIONS/*.md` + `deployments/*.json`, sourced from official docs, dated, and cited. Never from memory.
- Conventional commits; PR description notes AI assistance + spec sections touched.
```

---

# PHASE E · Environment & repo

## E1 · Developer environment + tooling manifest
> Create `docs/ENVIRONMENT.md` and `scripts/install_tools.sh` that install and pin the full toolchain, then verify with version prints:
> - **Rust:** rustup, stable toolchain pinned in `rust-toolchain.toml`; add the wasm target that the *current* soroban-sdk requires (check developers.stellar.org — `wasm32v1-none` on newer SDKs, `wasm32-unknown-unknown` on older; record the pair {rustc, sdk, target} as the baseline `DECISIONS.md` entry).
> - **Stellar:** `cargo install --locked stellar-cli`; configure identities: `stellar keys generate deployer-testnet --network testnet`; fund via friendbot; `stellar network add testnet --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"`.
> - **Rust QA:** `cargo install cargo-llvm-cov`; proptest as dev-dep; `cargo install cargo-fuzz` (nightly toolchain component added but NOT default); binaryen (`wasm-opt`) via system package.
> - **JS:** Node LTS via fnm/nvm, `corepack enable` + pnpm; workspace tooling: typescript, tsx, vitest, biome (lint+format).
> - **Local infra:** Docker + a `docker-compose.yml` providing Postgres 16 (for the indexer) with healthcheck.
> - **DX:** `just` task runner; create `justfile` with targets: `setup, build, test, cov, fuzz, lint, deploy-testnet, demo, bindings, app, indexer, docs`.
> **Accept when:** fresh machine → `./scripts/install_tools.sh && just setup && just test` succeeds; ENVIRONMENT.md lists every tool with pinned version and install command.

## E2 · Workspace scaffold + CI
> Scaffold the cargo workspace per spec §1 (`contracts/{vault,vault-factory,oracle-adapter,mock-oracle,mini-pool}`, `app/`, `packages/{sdk,bindings}/`, `services/indexer/`, `scripts/`, `tests/`, `INTEGRATIONS/`, `deployments/`). Use `stellar contract init` for one contract to capture current conventions, then normalize the rest to match. Add:
> - `.github/workflows/ci.yml`: jobs **fmt** (`cargo fmt --check`), **clippy** (`-D warnings`, all targets), **test** (workspace), **coverage** (`cargo llvm-cov --workspace --fail-under-lines 90` scoped to vault+mini-pool via `--package`; upload HTML artifact), **wasm** (build+`stellar contract optimize` each contract; upload .wasm artifacts + SHA256SUMS), **js** (pnpm install → biome check → vitest). Use Swatinem/rust-cache; concurrency group per-ref; required checks on `main`.
> - `.github/workflows/nightly.yml`: cron fuzz job (1h per target, nightly toolchain) + indexer image build.
> - Repo hygiene: LICENSE (Apache-2.0), NOTICE, CODEOWNERS (tracks per phase header), PR template asking "spec sections touched / DECISIONS entry? / AI-assisted?", empty `DECISIONS.md` with convention header from docs-hub §07.
> **Accept when:** PR to main shows all jobs green; wasm artifacts downloadable; branch protection documented in `docs/REPO.md`.

---

# PHASE C · Contracts

## C1 · `mock-oracle` (SEP-40-shaped)
> Implement per spec §5 with the read surface the adapter will consume: `lastprice(asset: Symbol) -> Option<PriceData{price: i128, timestamp: u64}>`, `decimals() -> u32`, plus admin `set_price(asset, price, ts)` and `set_decimals(u32)` (init-once). Instance storage: admin, decimals. Persistent: per-asset PriceData with extend_ttl on write. Events: `price_set(asset, price, ts)`. Errors: `NotInitialized, Unauthorized, UnknownAsset`. Unit tests: read-after-set, unknown asset → None, non-admin rejected, decimals immutability.
> **Accept when:** the C2 adapter tests can point at this contract with zero interface shims.

## C2 · `oracle-adapter` — fail-closed NAV
> Implement spec §5 exactly. Per-asset config in persistent storage: `{source: Address, source_decimals: u32, max_age_secs: u64 (default 90_000), max_dev_bps: u32 (default 200), last_accepted: {nav_scaled, ts}}`. `get_nav(asset) -> NavData{nav: i128 /*SCALE=10^12*/, ts}`:
> 1) call source `lastprice`; None → `OracleFailure`; 2) normalize price from `source_decimals` → SCALE with checked math; 3) `env.ledger().timestamp() - ts > max_age` → `StalePrice`; 4) if last_accepted exists: `|nav-last| * 10_000 > last * max_dev_bps` → `DeviationExceeded`; 5) store last_accepted (extend_ttl) and return.
> Admin: `configure_feed`, `set_bounds`, `accept_override(asset, nav)` emitting loud `override_accepted` event (prototype-only; code comment + DECISIONS entry).
> Tests: table-driven — fresh feed passes, exact-boundary age passes, age+1 fails, deviation exact-boundary passes/over fails, decimal normalization 7→12 and 14→12 golden cases, override path, config auth. Property: normalization round-trips within 1 ulp for random (price, decimals∈4..18).
> **Accept when:** no code path returns a nav without both checks; every error variant has a named test.

## C3 · `vault` — core accounting (crown jewel)
> Implement spec §3 completely. **Storage:** instance = {admin, underlying: Address, oracle: Address, asset_id: Symbol, cap: i128, paused: bool}; persistent = {TotalShares, Bal(Address), Allow(from,spender)} with extend_ttl on every touch. **Math (constants.rs):** SCALE=10^12, VIRT=10^3;
> `V = SAC.balance(vault) * nav / SCALE` (result in underlying's 7-dec quote units);
> deposit: before/after balance diff → `received`; `shares = received * (S+VIRT) / (V_before+VIRT)` floor; cap check on post-balance; withdraw: `amount = shares * (V+VIRT) / (S+VIRT)` floor, burn then transfer; `share_price() = (V+VIRT) * SCALE / (S+VIRT)`.
> **SEP-41 surface** on the same contract (transfer/transfer_from/approve/allowance/balance/decimals=7/name/symbol) — mint/burn internal only. **Admin:** set_cap, set_oracle, pause/unpause (deposits only — exits never pause), two-step transfer_admin. **Events + typed errors** exactly per spec.
> **Tests:** unit per fn/error; golden vectors loaded from `tests/fixtures/golden.json` (created in C8 — stub loader now); property (proptest, 10k cases): (a) ∀ deposit/withdraw sequences under monotone NAV, Σ withdrawn ≤ Σ deposited + NAV-growth value; (b) share_price monotone under non-decreasing (balance, nav); (c) inflation attack — attacker 1-stroop deposit + direct SAC donation before victim's 1e9 deposit → victim value loss < 1e-6; (d) donation raises share_price for all, mints nothing; (e) transfer conservation.
> **Accept when:** vault coverage ≥90%; PR description maps docs-hub §03 invariants → test names, no gaps.

## C4 · `vault-factory`
> Per spec §4: instance = {admin, vault_wasm_hash}; persistent registry Map<underlying, vault>. `deploy_vault(underlying, oracle, asset_id, cap) -> Address` via `deployer().with_current_contract(salt=hash(underlying)).deploy(wasm_hash)` then cross-contract `init`; duplicate underlying → `AlreadyDeployed`. `vault_of`, `set_wasm_hash` (admin), event `vault_deployed`. Tests: deploy→registry→duplicate rejected→child passes the full C3 suite via factory path (parametrize C3 integration fixture over {direct, factory} deployment).
> **Accept when:** C3 suite green against factory-deployed instance unchanged.

## C5 · `mini-pool` — isolated borrow market
> Per spec §6 minus liquidation. Instance = {admin, collateral: Address(vault), debt: Address(SAC), oracle, params{ltv_bps:8000, liq_threshold_bps:8500, liq_bonus_bps:500}}; persistent Positions map (extend_ttl). Valuation: `coll_value = shares * vault.share_price / SCALE * nav / SCALE` → document unit trail in code (shares→underlying units→USD-7dec). `health_factor = coll_value * liq_threshold_bps / 10_000 * SCALE / debt` (i128::MAX if debt=0). Zero interest — stated in rustdoc. Entry points per spec with post-condition checks (borrow → LTV, withdraw_collateral → hf ≥ SCALE). Tests: golden hf vectors vs committed fixture; LTV boundary ±1 stroop; unsafe-withdraw revert; auth on every fn.
> **Accept when:** golden vectors match `tests/fixtures/golden.json` pool section byte-for-byte.

## C6 · Permissioned liquidation
> Extend mini-pool per spec §6: persistent Whitelist map; admin `set_whitelist(who, ok)` + event. `liquidate(liquidator, user, repay)`: require_auth(liquidator) → `NotWhitelisted` unless whitelisted → require hf < SCALE → `repay ≤ debt/2` (close factor) → `seize = repay * (10_000+bonus_bps) * SCALE / 10_000 / share_value` with **ceil on the protocol-side division, floor on transfer-out**; ordering: pull debt from liquidator (transfer_from) → reduce position → transfer shares out → event `liquidated(user, liquidator, repay, seize)`. Tests: happy path; NotWhitelisted; hf≥1 revert; close-factor cap; rounding property (10k cases): pool value after ≥ value implied by exact rational math; re-liquidation until hf≥1 terminates.
> **Accept when:** `beat_5a/5b`-shaped unit tests pass and the rounding property is in CI.

## C7 · Integration suite `beat_1..beat_5b`
> In `tests/` (workspace integration crate) implement spec §8 end-to-end using soroban testutils: register a classic asset **LEOD** with issuer flags `auth_required|auth_revocable`, drive authorization via SAC admin `set_authorized`. Tests named exactly `beat_1_restricted_transfer_fails, beat_2_wrap_mints_share, beat_3_share_moves_and_borrows, beat_4_nav_tick_raises_price_while_pledged, beat_5a_whitelisted_liquidation, beat_5b_unwhitelisted_rejected`. Each test's doc-comment is a one-line video caption (S2 consumes them).
> **Accept when:** suite green in CI; `just demo-local` runs only these six with pretty output.

## C8 · Golden vectors + fuzz harness + threat tie-out
> (1) `tests/fixtures/golden_gen.py` (Python `decimal`, precision 50): generate JSON vectors for — first deposit @ nav 1.0209; second depositor after NAV→1.0409; rebase tick (+0.19% balance) then withdraw-all; dust deposit (1 stroop); cap-edge deposit; pool hf at three NAV points; seize amounts at bonus 500 bps. Commit script + `golden.json`; Rust loaders in C3/C5 consume it.
> (2) Fuzz targets (cargo-fuzz, nightly, run in nightly.yml): `fuzz_vault_sequences` (arbitrary deposit/withdraw/transfer/donation interleavings with NAV walks inside deviation bounds — assert invariants a/b/e), `fuzz_pool_sequences` (borrow/repay/liquidate under NAV walks — assert solvency: total debt ≤ total coll_value at liq_threshold after each op or position liquidatable).
> (3) `SECURITY-TESTING.md`: table mapping every docs-hub §03 threat row → {test|fuzz target|drill}; zero "untested" rows. This file is the Audit Bank hand-off.
> **Accept when:** 1h nightly fuzz clean on both targets; tie-out table complete.

---

# PHASE D · Deployment & infra

## D1 · Testnet bring-up + demo scripts
> `scripts/setup_testnet.sh` (bash, `set -euo pipefail`, idempotence NOT required, fresh-account rerun IS): create+fund accounts (issuer, admin, alice, bob, liquidator, rando) via friendbot with retry; issue **LEOD** with `auth_required|auth_revocable` (set via set-options on issuer); establish trustlines; deploy SAC (`stellar contract asset deploy --asset LEOD:<issuer>`); deploy mock-oracle → adapter (configure LEOD feed, decimals) → factory (install vault wasm, set hash) → `deploy_vault` → issue test-USDC + SAC → deploy mini-pool → whitelist liquidator → SAC-admin `set_authorized(vault, true)` (NOT rando — that's beat 1) → seed balances → write every ID/key to `deployments/testnet.json` + `deploy.env`. `scripts/demo.sh`: execute beats 1→5b via stellar-cli invocations, print tx hashes + `https://stellar.expert/explorer/testnet/tx/<hash>` links, nonzero exit on any unexpected success/failure.
> **Accept when:** screen-recorded fresh-account run completes; `deploy.env` consumed by A2 with no edits.

## D2 · Release pipeline + address registry
> On git tag `v*`: workflow builds each contract, runs `stellar contract optimize`, emits SHA256SUMS, creates GitHub Release with wasm assets; `deployments/{testnet,mainnet}.json` schema: `{contract, address, wasm_hash, tag, deployed_at, deployer, tx}` — updated by deploy scripts, validated in CI (schema + no-orphan check). `docs/ADDRESSES.md` auto-generated from the JSONs (just target).
> **Accept when:** tagging produces a release whose wasm_hash matches what `stellar contract fetch` returns for the deployed testnet contracts.

## D3 · Multisig + admin handover (mainnet pattern, rehearsed on testnet)
> Script + runbook `docs/MULTISIG.md`: create admin account; add 3 signers (hardware-wallet pubkeys) each weight 1; set master weight 0; thresholds low/med/high = 2 → **2-of-3**. Rehearse on testnet: deploy from ephemeral deployer key → contract `transfer_admin` two-step to multisig → execute one param change (set_cap) via 2 signatures using `stellar tx sign` multi-sig flow → verify → document exact commands. Mainnet secrets policy: deployer key ephemeral (generated in-ceremony, funded exactly, zeroed after handover); signer keys never touch CI.
> **Accept when:** testnet rehearsal recorded; MULTISIG.md is copy-paste executable; a second team member reproduces it.

## D4 · Monitoring, alerting, hosting
> Stand up ops per docs-hub §05: **Hosting** — app on Vercel (project envs: testnet/mainnet), indexer worker + Postgres (Neon or Railway PG) on Railway/Fly (pick, record in DECISIONS with pricing note); **Alerting** — indexer-computed alerts → Discord webhook: share_price step >25 bps, oracle staleness > max_age·0.8, any `override_accepted`/`paused` event, hf<1 position count, cap utilization >80%; heartbeat to Healthchecks.io (alert on silence); **Frontend** — Sentry (errors) with DSN via env; **Status** — Upptime (GitHub-based) or Instatus free page monitoring RPC-read canary + app + API. **Secrets matrix** in `docs/SECRETS.md`: which secret lives where (GH Actions / Vercel / Railway / local .env.example), rotation owner per secret. Testnet deployer key allowed in GH secrets; mainnet keys NEVER in CI (see D3).
> **Accept when:** killing the indexer fires a Discord alert ≤5 min; a forced oracle-stale drill on testnet fires the staleness alert; SECRETS.md has zero "TBD" rows.

---

# PHASE A · App & services

## A1 · TypeScript bindings + SDK
> Generate typed clients: `stellar contract bindings typescript --network testnet --contract-id <id> --output-dir packages/bindings/<name>` for vault, factory, adapter, mini-pool (verify current flags with `--help`; wrap in `just bindings` reading deployments/testnet.json). Build `packages/sdk` (`@leontief/sdk`, MIT): ergonomic layer over bindings — `wrap(), unwrap(), quoteShares(), sharePrice(), positions(), healthFactor(), liquidate()`; RPC read via simulation; tx build/sign hooks accepting any signer (Freighter, keypair, passkey). Vitest: unit vs mocked RPC + one live-testnet smoke (env-gated). `examples/{deposit.ts,borrow.ts,liquidate.ts}` runnable with tsx against deploy.env verbatim.
> **Accept when:** A2/A3 consume ONLY the SDK (no raw bindings imports outside packages/sdk); examples run green.

## A2 · dApp wiring (wallets incl. passkey option)
> Wire `app/` to testnet through the SDK. **Wallets:** integrate `@creit.tech/stellar-wallets-kit` for the modal (Freighter, xBull, etc.); add optional **passkey smart-wallet** path via `passkey-kit` + Launchtube testnet credits behind a feature flag (record Launchtube endpoint/token setup in INTEGRATIONS/passkeys.md — team has prior art from Pesalo). Reads: share_price, balances, positions, hf via simulation with SWR polling (12s). Writes: deposit/withdraw/supply/borrow/repay with pre-flight simulation, human-readable mapping of typed contract errors (error-code → copy table in one file), toast+explorer link on success. Contract IDs strictly from env (Vercel envs mirror deploy.env). NO visual redesign — bind data into the frozen design system only.
> **Accept when:** a non-dev completes beats 2–4 from the UI following README §Quickstart; error table covers every contract error variant.

## A3 · Indexer + API
> `services/indexer` (TypeScript): poll Soroban RPC `getEvents` for all Leontief contracts with **persisted cursor** (public RPC event retention is days, not months — the poller must never gap; on cursor loss, backfill via getLedgerEntries reads and mark discontinuity). Postgres schema: events, share_price_series, positions_snapshot, metrics_daily; migrations via node-pg-migrate. REST (Fastify): `/metrics` (TVL, suppliers, borrows, utilization), `/vaults/:id/history`, `/positions/at-risk?hf_lt=1.1`, `/health`. Alternative managed path (Mercury/xycloo) evaluated in INTEGRATIONS/indexing.md — decision recorded, poller is the default. Vitest with a recorded-events fixture.
> **Accept when:** dashboard numbers (A4) match direct RPC reads across a 24h soak; restart resumes from cursor with zero duplicate rows (unique constraint proves it).

## A4 · Public metrics dashboard
> `/stats` route in app/ consuming A3: TVL, unique suppliers, share_price chart per vault, utilization ratio (deployed shares / total — *the* KPI), borrow volume, liquidation log. Design-system components only; this page is the SCF "onchain growth measurement" artifact — put the 90-day targets on it with live progress.
> **Accept when:** page is public, loads <2s, and every number links to its data source (tx list or API).

## A5 · Liquidator console
> `/liquidate` route: wallet-gated whitelist check (read), at-risk table from `/positions/at-risk`, per-position seize preview via SDK simulation (repay input → seize output, bonus shown), execute with confirm modal, history from indexer. Non-whitelisted wallets see an explanatory state + application contact — never a broken button.
> **Accept when:** scripted at-risk position (D1 helper `scripts/make_at_risk.sh`) is liquidated through the console on testnet, recorded.

## A6 · Issuer / compliance panel
> `/issuer` route: per-asset authorization state, cap + utilization bar, oracle config + last NAV/ts + bounds, pause status, param-change event log stream. Writes (pause, set_cap) only when connected wallet is a multisig signer — build the tx, export XDR for co-signing (reuse D3 flow), never single-sig on mainnet config.
> **Accept when:** the docs-hub §05 freeze-response drill is executable start-to-finish from this panel on testnet, recorded.

---

# PHASE X · Ecosystem integrations (research → record → implement)

## X1 · Reflector live feeds (replace mocks)
> Step 1: write `INTEGRATIONS/reflector.md` from https://reflector.network + docs — record testnet oracle contract IDs, the asset enum shape their SEP-40 exposes (Stellar(Address) vs Other(Symbol)), price decimals, update cadence/resolution, and which of USDY/CETES/USTRY (or nearest testnet stand-ins) have feeds; date + cite everything. Step 2: extend oracle-adapter config to consume the real interface (map our Symbol asset_id → their asset enum); recalibrate max_age to their cadence ×2.5. Step 3: deviation-breaker drill against live feed (set tight bound, observe halt, restore) — recorded. If a needed feed doesn't exist on testnet, keep mock for that asset and record the mainnet feed plan.
> **Accept when:** adapter reads live Reflector on testnet for ≥1 asset; drill video committed; reflector.md has zero unsourced claims.

## X2 · Blend pool with ld-share collateral
> Step 1: `INTEGRATIONS/blend.md` from docs.blend.capital + blend-contracts repo — record: pool-factory address (testnet), reserve config semantics (c_factor≈LTV, l_factor, util/max_util, r_base/r_one/r_two/r_three or current IR params), **backstop activation requirements** (BLND:USDC LP threshold to move pool Setup→Active; testnet faucet path), and the oracle interface Blend pools consume. Step 2: implement `contracts/blend-price-adapter` exposing Blend's expected price interface, sourcing `vault.share_price × adapter.get_nav` composition — same fail-closed policy (if we halt, Blend sees stale → their protections engage). Step 3: `scripts/deploy_blend_pool.sh` — deploy pool via factory with ldUSDY reserve (c_factor conservative: 7000), meet testnet backstop threshold via faucet, activate, then execute supply-collateral + borrow-USDC through `@blend-capital/blend-sdk`; extend A2 with a "Borrow on Blend" path behind a flag.
> **Accept when:** end-to-end borrow against ld-share in a real Blend testnet pool, tx hashes in blend.md; mini-pool relegated to demo/liquidation-drill status in docs.

## X3 · Aquarius LP path
> Step 1: `INTEGRATIONS/aquarius.md` — from Aquarius docs: current AMM contract set on Soroban testnet (pool creation, add/remove liquidity call shapes, fee tiers), reward eligibility rules, and whether permissionless pool creation is live on testnet; date + cite. Step 2: `scripts/create_aqua_pool.sh` creating ldUSDY/USDC pool + seeding minimal liquidity; SDK helpers `addLiquidity/removeLiquidity`; A2 "Provide liquidity" flow behind a flag. Fallback if Soroban AMM path is blocked on testnet: classic SDEX orderbook demo for the share (documented as fallback, not the product).
> **Accept when:** LP position opened+closed on testnet via the UI, recorded; aquarius.md decision log complete.

---

# PHASE S · Ship

## S1 · Docs site
> Assemble the public GitBook (mdBook fallback → DECISIONS) from `leontief-docs-hub.md` structure: embed the three mermaid diagrams, litepaper, frozen spec, ADDRESSES.md, live dashboard link, demo video, SECURITY-TESTING.md, disclosure/security-contact page, Contributing, and the INTEGRATIONS/ research docs (they demonstrate rigor — publish them).
> **Accept when:** one public URL satisfies every item in SCF's "unified source" list; link-checker CI job passes.

## S2 · Demo video kit
> `scripts/record_demo.md` + helper: run demo.sh with beat doc-comments rendered as on-screen captions (asciinema or OBS scene notes), then the SCF ≤3-min cut checklist: team intro slots (names/roles/prior artifact), the 5 beats with explorer links visible, live /stats close. All numbers pulled live — nothing staged or mocked in the recording.
> **Accept when:** one-take recording achievable by a teammate who didn't write the kit.

## S3 · Mainnet launch runbook (execute at Tranche 3)
> `docs/MAINNET.md`: preflight gate (Audit Bank findings remediated + regression suite, coverage report, D3 rehearsal done, D4 alerts live, caps per docs-hub §02 policy: min($500K, 10% Stellar float, 25% weekly redemption capacity)); ceremony order: deploy via ephemeral key → verify wasm_hash vs release → transfer_admin to multisig → configure feeds (mainnet Reflector IDs from X1 research) → set caps → pause-drill on mainnet with dust → update deployments/mainnet.json + ADDRESSES.md → announce checklist (docs, status page, issuer co-post). Rollback stance: contracts are immutable — "rollback" = pause deposits + comms plan, written here, not improvised.
> **Accept when:** the runbook is executed on testnet as a full dress rehearsal, timed, with a filled checklist committed.

---

### Suggested PR order
E1 → E2 → C1 → C2 → C3 → C4 → C5 → C6 → C7 → C8 → D1 → A1 → A2 → A3 → A4 → D2 → C-hardening from fuzz → A5 → A6 → X1 → X2 → X3 → D3 → D4 → S1 → S2 → (award T3) → S3.
Weekly gates from spec §10 unchanged: W1 = through D1 beats 1; W2 = C5/C6 + beats 2–3; W3 = full beat suite + coverage; W4 = video + docs + repo public.
