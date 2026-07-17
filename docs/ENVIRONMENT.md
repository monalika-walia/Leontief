# Developer environment

One command bootstraps a fresh machine:

```sh
./scripts/install_tools.sh && just setup && just test
```

## Pinned toolchain (baseline — DECISIONS.md entry #1, 2026-07-16)

| Tool | Version | Pinned where | Install |
|---|---|---|---|
| rustc / cargo | **1.97.1** | `rust-toolchain.toml` | rustup (`install_tools.sh`) |
| wasm target | **wasm32v1-none** | `rust-toolchain.toml` | `rustup target add wasm32v1-none` |
| soroban-sdk | **27.0.0** | workspace `Cargo.toml` + `Cargo.lock` | cargo dependency |
| stellar-cli | **27.0.0** | `install_tools.sh` | prebuilt release binary (fallback: `cargo install --locked stellar-cli`) |
| just | 1.56.0 | `install_tools.sh` | prebuilt release binary |
| cargo-llvm-cov | latest | — | prebuilt release binary (fallback: cargo install) |
| cargo-fuzz | latest | — | `cargo install --locked cargo-fuzz` (runs on the nightly toolchain; nightly installed but **not** default) |
| binaryen (wasm-opt) | ≥108 | — | `apt install binaryen` |
| Node | LTS (≥24) | `.nvmrc` (app) | fnm/nvm; Codespaces image ships it |
| pnpm | ≥10 | `packageManager` field | `corepack enable` |
| Docker + compose | any recent | — | for Postgres 16 (indexer), see `docker-compose.yml` |
| Python 3 | ≥3.10 | — | golden-vector generator (`tests/fixtures/golden_gen.py`) — stdlib only |

**Never bump `rust-toolchain.toml` or soroban-sdk unasked** (CLAUDE.md non-negotiable). A bump is a
DECISIONS.md entry.

**Known transitive pin (Cargo.lock):** `ed25519-dalek` is held at **2.2.0** — `soroban-env-host
27.0.0` has a loose bound that resolves to 3.0.0, which breaks its build (rand_core trait change).
A blanket `cargo update` will reintroduce the breakage; re-pin with
`cargo update -p ed25519-dalek@3.0.0 --precise 2.2.0` if it ever reappears.

## Network facts (verified live 2026-07-16, testnet protocol 27)

- RPC `https://soroban-testnet.stellar.org` · Horizon `https://horizon-testnet.stellar.org` · Friendbot `https://friendbot.stellar.org`
- Passphrase: `Test SDF Network ; September 2015`
- State-archival settings (via `stellar network settings --output json`):
  `max_entry_ttl = 3_110_400` ledgers (~180 d) · `min_persistent_ttl = 120_960` (~7 d) · `min_temporary_ttl = 720`.
  Contract TTL constants (`contracts/*/src/constants.rs`) derive from these:
  extend when < 30 d remain (`518_400`), extend to the max (`3_110_400`).

## Identities

`install_tools.sh` creates and friendbot-funds `deployer-testnet`. Additional demo accounts
(issuer, admin, alice, bob, liquidator, rando) are created by `scripts/setup_testnet.sh` (Phase D1).
Mainnet keys never touch this repo, CI, or any dev box (see docs/MULTISIG.md, Phase D3).

## Local infra

`docker-compose.yml` provides Postgres 16 with a healthcheck for the indexer:

```sh
docker compose up -d postgres   # localhost:5432, db/user/pass: leontief
```

## Task runner

`just --list` is the source of truth. Key targets: `setup`, `build` (wasm), `test`, `cov`
(≥90 % gate on vault + mini-pool), `fuzz`, `lint`, `check` (the PR gate), `deploy-testnet`,
`demo`, `demo-local`, `bindings`, `app`, `indexer`, `docs`.
