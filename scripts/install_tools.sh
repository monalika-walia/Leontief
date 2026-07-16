#!/usr/bin/env bash
# Leontief toolchain installer — idempotent; safe to re-run.
# Installs and pins every tool in docs/ENVIRONMENT.md, then prints versions.
set -euo pipefail

RUST_VERSION="1.97.1"          # keep in sync with rust-toolchain.toml
STELLAR_CLI_VERSION="27.0.0"   # matches soroban-sdk 27.0.0 (DECISIONS.md #1)
JUST_VERSION="1.56.0"
BIN_DIR="${HOME}/.local/bin"
mkdir -p "${BIN_DIR}"
export PATH="${BIN_DIR}:${HOME}/.cargo/bin:${PATH}"

log() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

# --- Rust -------------------------------------------------------------------
if ! command -v rustup >/dev/null 2>&1; then
  log "Installing rustup + Rust ${RUST_VERSION}"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain "${RUST_VERSION}" --profile minimal \
      --component clippy,rustfmt,llvm-tools-preview
  # shellcheck disable=SC1091
  source "${HOME}/.cargo/env"
else
  log "rustup present — ensuring toolchain ${RUST_VERSION}"
  rustup toolchain install "${RUST_VERSION}" --profile minimal \
    --component clippy,rustfmt,llvm-tools-preview
fi
rustup target add wasm32v1-none --toolchain "${RUST_VERSION}"
# Nightly for cargo-fuzz only — never the default toolchain.
rustup toolchain install nightly --profile minimal || true

# --- stellar-cli (prebuilt binary; cargo install fallback) --------------------
if ! command -v stellar >/dev/null 2>&1 || [[ "$(stellar version 2>/dev/null | head -1)" != *"${STELLAR_CLI_VERSION}"* ]]; then
  log "Installing stellar-cli ${STELLAR_CLI_VERSION}"
  if ! curl -fsSL "https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_CLI_VERSION}/stellar-cli-${STELLAR_CLI_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
      | tar xz -C "${BIN_DIR}"; then
    echo "prebuilt download failed — falling back to cargo install (slow)"
    cargo install --locked stellar-cli --version "${STELLAR_CLI_VERSION}"
  fi
fi

# --- just ---------------------------------------------------------------------
if ! command -v just >/dev/null 2>&1; then
  log "Installing just ${JUST_VERSION}"
  curl -fsSL "https://github.com/casey/just/releases/download/${JUST_VERSION}/just-${JUST_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    | tar xz -C "${BIN_DIR}" just
fi

# --- Rust QA: cargo-llvm-cov, cargo-fuzz, binaryen ----------------------------
if ! cargo llvm-cov --version >/dev/null 2>&1; then
  log "Installing cargo-llvm-cov"
  curl -fsSL "https://github.com/taiki-e/cargo-llvm-cov/releases/latest/download/cargo-llvm-cov-x86_64-unknown-linux-gnu.tar.gz" \
    | tar xz -C "${HOME}/.cargo/bin" \
    || cargo install --locked cargo-llvm-cov
fi
if ! command -v cargo-fuzz >/dev/null 2>&1; then
  log "Installing cargo-fuzz"
  cargo install --locked cargo-fuzz
fi
if ! command -v wasm-opt >/dev/null 2>&1; then
  log "Installing binaryen (wasm-opt)"
  sudo apt-get update -qq && sudo apt-get install -y -qq binaryen
fi

# --- JS: Node LTS + pnpm ------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  log "Installing Node LTS via fnm"
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
  export PATH="${HOME}/.local/share/fnm:${PATH}"
  eval "$(fnm env)"
  fnm install --lts && fnm default lts-latest
fi
command -v pnpm >/dev/null 2>&1 || { log "Enabling pnpm via corepack"; corepack enable; }

# --- Stellar identities + network (testnet) -----------------------------------
log "Configuring stellar testnet network + deployer identity"
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" 2>/dev/null || true
if ! stellar keys address deployer-testnet >/dev/null 2>&1; then
  stellar keys generate deployer-testnet --network testnet --fund \
    || echo "WARN: friendbot funding failed (offline?) — rerun: stellar keys fund deployer-testnet --network testnet"
fi

# --- Verify -------------------------------------------------------------------
log "Installed versions"
rustc --version
cargo --version
rustup target list --installed --toolchain "${RUST_VERSION}" | grep wasm32 || true
stellar --version | head -1
just --version
cargo llvm-cov --version
cargo fuzz --version 2>/dev/null || echo "cargo-fuzz: (nightly-only tool) $(cargo-fuzz --version 2>/dev/null || true)"
wasm-opt --version
node --version
pnpm --version
docker --version 2>/dev/null || echo "WARN: docker not found — needed for the indexer's Postgres (docker-compose.yml)"
echo
echo "OK — toolchain ready. Next: just setup && just test"
