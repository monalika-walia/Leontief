# Leontief task runner — `just --list` for the menu.

set shell := ["bash", "-euo", "pipefail", "-c"]

contracts := "vault vault-factory oracle-adapter mock-oracle mini-pool"
core_cov_packages := "--package vault --package mini-pool"

default:
    @just --list

# One-time workspace setup after install_tools.sh
setup:
    cargo fetch
    if [ -f pnpm-workspace.yaml ]; then pnpm install; fi

# Build every contract to optimized wasm in target/wasm/
build:
    mkdir -p target/wasm
    for c in {{contracts}}; do \
        stellar contract build --package "$c"; \
    done
    for f in target/wasm32v1-none/release/*.wasm; do \
        n=$(basename "$f"); \
        stellar contract optimize --wasm "$f" --wasm-out "target/wasm/$n"; \
    done
    (cd target/wasm && sha256sum *.wasm | tee SHA256SUMS)

# Full Rust test suite
test:
    cargo test --workspace --all-targets

# Coverage with the ≥90% gate on the core contracts (vault + mini-pool)
cov:
    cargo llvm-cov {{core_cov_packages}} --fail-under-lines 90 --html
    @echo "HTML report: target/llvm-cov/html/index.html"

# Fuzz targets (nightly toolchain); RUNS seconds per target, default 60
fuzz seconds="60":
    cd fuzz && for t in $(cargo +nightly fuzz list); do \
        cargo +nightly fuzz run "$t" -- -max_total_time={{seconds}}; \
    done

# Format + lint, no changes
lint:
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets -- -D warnings
    if [ -f pnpm-workspace.yaml ]; then pnpm biome ci .; fi

fmt:
    cargo fmt --all
    if [ -f pnpm-workspace.yaml ]; then pnpm biome format --write .; fi

# The PR gate (CLAUDE.md): fmt, clippy, tests, coverage
check: lint test cov

# Deploy the full system to testnet from fresh accounts (Phase D1)
deploy-testnet:
    ./scripts/setup_testnet.sh

# Run the 5-beat demo against the last testnet deployment (Phase D1)
demo:
    ./scripts/demo.sh

# Run only the six integration beats locally with pretty output (C7)
demo-local:
    cargo test --package leontief-integration beat_ -- --nocapture --test-threads 1

# Generate TypeScript bindings from deployments/testnet.json (Phase A1)
bindings:
    ./scripts/gen_bindings.sh

# Frontend dev server (Phase A2)
app:
    pnpm --filter app dev

# Indexer worker (Phase A3); needs `docker compose up -d postgres`
indexer:
    pnpm --filter indexer dev

# Regenerate golden vectors (C8) — commit the diff deliberately
golden:
    python3 tests/fixtures/golden_gen.py

# Regenerate docs/ADDRESSES.md from deployments/*.json (Phase D2)
docs:
    ./scripts/gen_addresses.sh
