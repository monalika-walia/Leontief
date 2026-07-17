#!/usr/bin/env bash
# setup_testnet.sh — bring the whole Leontief stack up on Stellar testnet (D1).
#
# Fresh-account rerun IS supported (new random keys each run); idempotence is NOT
# a goal. Deploys: restricted LEOD (auth_required|auth_revocable) + SAC,
# test-USDC + SAC, mock-oracle → oracle-adapter → vault-factory → vault →
# mini-pool, wires them, seeds balances, and writes deployments/testnet.json +
# deploy.env. NOTE: multisig admin handover (D3) is intentionally SKIPPED for the
# MVP — admin stays a single ephemeral key; see docs/MAINNET.md before mainnet.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

NET="testnet"
RPC="https://soroban-testnet.stellar.org"
PASSPHRASE="Test SDF Network ; September 2015"
WASM_DIR="target/wasm"
OUT_JSON="deployments/testnet.json"
OUT_ENV="deploy.env"
STAMP="${SETUP_STAMP:-unknown}"   # pass a timestamp in (Date is unavailable in some CI); optional

# Unique suffix so reruns don't collide on identity aliases.
SFX="$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

stellar network add "$NET" --rpc-url "$RPC" --network-passphrase "$PASSPHRASE" 2>/dev/null || true

# ── helpers ────────────────────────────────────────────────────────────────────
gen() { # gen <alias> — create + friendbot-fund a testnet identity, print its G-address
  local a="$1_$SFX"
  stellar keys generate "$a" --network "$NET" --fund >/dev/null 2>&1 || {
    for _ in 1 2 3 4 5; do stellar keys fund "$a" --network "$NET" >/dev/null 2>&1 && break; sleep 2; done
  }
  stellar keys address "$a"
}
alias_of() { echo "$1_$SFX"; }

CID() { # capture the last non-empty line (contract id / return value) from a deploy/invoke
  awk 'NF{l=$0} END{print l}' | tr -d '"'
}

log "1 · Accounts (issuer, admin, alice, bob, liquidator, rando)"
ISSUER=$(gen issuer);       note "issuer     $ISSUER"
ADMIN=$(gen admin);         note "admin      $ADMIN"
ALICE=$(gen alice);         note "alice      $ALICE"
BOB=$(gen bob);             note "bob        $BOB"
LIQ=$(gen liquidator);      note "liquidator $LIQ"
RANDO=$(gen rando);         note "rando      $RANDO"
A_ISSUER=$(alias_of issuer); A_ADMIN=$(alias_of admin); A_ALICE=$(alias_of alice)
A_BOB=$(alias_of bob); A_LIQ=$(alias_of liquidator); A_RANDO=$(alias_of rando)

LEOD_ASSET="LEOD:$ISSUER"
# USDC is issued by ADMIN (no auth flags) — auth_required is an ISSUER-level flag,
# so USDC must come from a different, unrestricted issuer to stay freely borrowable.
USDC_ASSET="USDC:$ADMIN"

log "2 · LEOD is a genuine SEP-8 asset (auth_required | auth_revocable)"
stellar tx new set-options --source-account "$A_ISSUER" --network "$NET" \
  --set-required --set-revocable --fee 1000 >/dev/null
note "issuer flags set"

log "3 · Deploy the Stellar Asset Contracts (SAC) for LEOD and USDC"
LEOD_SAC=$(stellar contract asset deploy --asset "$LEOD_ASSET" --source "$A_ISSUER" --network "$NET" 2>/dev/null | CID)
note "LEOD SAC  $LEOD_SAC"
USDC_SAC=$(stellar contract asset deploy --asset "$USDC_ASSET" --source "$A_ADMIN" --network "$NET" 2>/dev/null | CID)
note "USDC SAC  $USDC_SAC"

# Trustlines for classic holders (contracts hold via SAC balance, no trustline).
log "4 · Trustlines + authorize LEOD holders (alice, bob, liquidator; NOT rando)"
for pair in "$A_ALICE:$ALICE" "$A_BOB:$BOB" "$A_LIQ:$LIQ" "$A_RANDO:$RANDO"; do
  al="${pair%%:*}"
  stellar tx new change-trust --source-account "$al" --network "$NET" --line "$LEOD_ASSET" --fee 1000 >/dev/null
done
# rando gets a trustline but is deliberately left UN-authorized (beat 1 target).
for pair in "$A_ALICE:$ALICE" "$A_BOB:$BOB" "$A_LIQ:$LIQ"; do
  addr="${pair##*:}"
  stellar tx new set-trustline-flags --source-account "$A_ISSUER" --network "$NET" \
    --trustor "$addr" --asset "$LEOD_ASSET" --set-authorize --fee 1000 >/dev/null
done
note "alice/bob/liquidator authorized; rando left restricted"

log "5 · Issue LEOD to alice, USDC to liquidator (USDC trustlines first)"
# alice + bob borrow in the demo; liquidator repays — all need a USDC trustline.
for al in "$A_ALICE" "$A_BOB" "$A_LIQ"; do
  stellar tx new change-trust --source-account "$al" --network "$NET" --line "$USDC_ASSET" --fee 1000 >/dev/null
done
stellar tx new payment --source-account "$A_ISSUER" --network "$NET" \
  --destination "$ALICE" --asset "$LEOD_ASSET" --amount 100000000000 --fee 1000 >/dev/null   # 10,000 LEOD
stellar tx new payment --source-account "$A_ADMIN" --network "$NET" \
  --destination "$LIQ" --asset "$USDC_ASSET" --amount 100000000000 --fee 1000 >/dev/null      # 10,000 USDC
note "alice holds 10,000 LEOD; liquidator holds 10,000 USDC"

# ── Contracts ───────────────────────────────────────────────────────────────────
inv() { stellar contract invoke --id "$1" --source "$2" --network "$NET" -- "${@:3}"; }

log "6 · mock-oracle → oracle-adapter (fail-closed), feed LEOD @ NAV 1.0209"
MOCK=$(stellar contract deploy --wasm "$WASM_DIR/mock_oracle.wasm" --source "$A_ADMIN" --network "$NET" 2>/dev/null | CID)
inv "$MOCK" "$A_ADMIN" init --admin "$ADMIN" --decimals 14 >/dev/null
# Timestamp must be recent (testnet ledger uses real wall-clock time) or the
# fail-closed adapter rejects it as stale (default max_age 90_000 s / 25 h).
inv "$MOCK" "$A_ADMIN" set_price --asset LEOD --price 102090000000000 --ts "$(date +%s)" >/dev/null
note "mock-oracle $MOCK"
ADAPTER=$(stellar contract deploy --wasm "$WASM_DIR/oracle_adapter.wasm" --source "$A_ADMIN" --network "$NET" 2>/dev/null | CID)
inv "$ADAPTER" "$A_ADMIN" init --admin "$ADMIN" >/dev/null
inv "$ADAPTER" "$A_ADMIN" configure_feed --asset LEOD --source "$MOCK" --source_decimals 14 >/dev/null
note "oracle-adapter $ADAPTER"

log "7 · vault-factory → deploy the LEOD vault"
VAULT_HASH=$(stellar contract upload --wasm "$WASM_DIR/vault.wasm" --source "$A_ADMIN" --network "$NET" 2>/dev/null | CID)
FACTORY=$(stellar contract deploy --wasm "$WASM_DIR/vault_factory.wasm" --source "$A_ADMIN" --network "$NET" 2>/dev/null | CID)
inv "$FACTORY" "$A_ADMIN" init --admin "$ADMIN" --vault_wasm_hash "$VAULT_HASH" >/dev/null
VAULT=$(inv "$FACTORY" "$A_ADMIN" deploy_vault --underlying "$LEOD_SAC" --oracle "$ADAPTER" --asset_id LEOD --cap 10000000000000 2>/dev/null | CID)
note "vault-factory $FACTORY"
note "vault (ldLEOD) $VAULT"

log "8 · mini-pool (collateral = vault, debt = USDC), whitelist liquidator"
POOL=$(stellar contract deploy --wasm "$WASM_DIR/mini_pool.wasm" --source "$A_ADMIN" --network "$NET" 2>/dev/null | CID)
inv "$POOL" "$A_ADMIN" init --admin "$ADMIN" --collateral "$VAULT" --debt "$USDC_SAC" --oracle "$ADAPTER" >/dev/null
inv "$POOL" "$A_ADMIN" set_whitelist --who "$LIQ" --ok true >/dev/null
note "mini-pool $POOL"

log "9 · Authorize the vault to hold LEOD (SAC admin) + seed pool USDC liquidity"
inv "$LEOD_SAC" "$A_ISSUER" set_authorized --id "$VAULT" --authorize true >/dev/null
# Seed the pool with USDC borrow liquidity (SAC mint, USDC admin = admin).
inv "$USDC_SAC" "$A_ADMIN" mint --to "$POOL" --amount 100000000000 >/dev/null   # 10,000 USDC
note "vault authorized for LEOD; pool seeded with 10,000 USDC"

# ── Outputs ─────────────────────────────────────────────────────────────────────
log "10 · Write deployments/testnet.json + deploy.env"
mkdir -p deployments
cat > "$OUT_ENV" <<EOF
# Generated by scripts/setup_testnet.sh — do NOT commit (gitignored).
export STELLAR_NETWORK=testnet
export STELLAR_RPC_URL=$RPC
export ISSUER=$ISSUER
export ADMIN=$ADMIN
export ALICE=$ALICE
export BOB=$BOB
export LIQUIDATOR=$LIQ
export RANDO=$RANDO
export LEOD_SAC=$LEOD_SAC
export USDC_SAC=$USDC_SAC
export MOCK_ORACLE=$MOCK
export ORACLE_ADAPTER=$ADAPTER
export VAULT_FACTORY=$FACTORY
export VAULT=$VAULT
export MINI_POOL=$POOL
export VAULT_WASM_HASH=$VAULT_HASH
export ALIAS_SUFFIX=$SFX
# Throwaway TESTNET demo secret keys — consumed by the dApp /demo stepper (A2-P).
# deploy.env is gitignored; these never touch mainnet or CI.
export DEMO_ISSUER_SK=$(stellar keys show "$A_ISSUER")
export DEMO_ADMIN_SK=$(stellar keys show "$A_ADMIN")
export DEMO_USER_SK=$(stellar keys show "$A_ALICE")
export DEMO_LIQUIDATOR_SK=$(stellar keys show "$A_LIQ")
export DEMO_RANDO_SK=$(stellar keys show "$A_RANDO")
EOF

python3 - "$OUT_JSON" "$STAMP" <<PY
import json, sys, os
out, stamp = sys.argv[1], sys.argv[2]
env = {}
for line in open("$OUT_ENV"):
    line = line.strip()
    if line.startswith("export "):
        k, v = line[len("export "):].split("=", 1)
        env[k] = v
contracts = {
    "leod_sac": env["LEOD_SAC"], "usdc_sac": env["USDC_SAC"],
    "mock_oracle": env["MOCK_ORACLE"], "oracle_adapter": env["ORACLE_ADAPTER"],
    "vault_factory": env["VAULT_FACTORY"], "vault": env["VAULT"], "mini_pool": env["MINI_POOL"],
}
doc = {
    "network": "testnet", "deployed_at": stamp, "deployer": env["ADMIN"],
    "issuer": env["ISSUER"], "vault_wasm_hash": env["VAULT_WASM_HASH"],
    "accounts": {k: env[k] for k in ["ISSUER","ADMIN","ALICE","BOB","LIQUIDATOR","RANDO"]},
    "contracts": contracts,
    "explorer": {k: f"https://stellar.expert/explorer/testnet/contract/{v}" for k, v in contracts.items()},
}
json.dump(doc, open(out, "w"), indent=2)
open(out, "a").write("\n")
print("wrote", out)
PY

log "Done — stack live on testnet."
note "deploy.env + deployments/testnet.json written."
note "Run the 5-beat demo:  ./scripts/demo.sh"
