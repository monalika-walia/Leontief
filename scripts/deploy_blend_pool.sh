#!/usr/bin/env bash
# deploy_blend_pool.sh — X2: deploy the blend-price-adapter, then stand up a real
# Blend V2 testnet pool that accepts ld-shares (ldLEOD) as collateral and lets a
# user borrow USDC against them.
#
# Verified Blend V2 testnet addresses: INTEGRATIONS/blend.md (from blend-utils
# testnet.contracts.json + docs.blend.capital, 2026-07-17).
#
# The adapter deploy + configure (§1) runs fully from this repo. Pool creation +
# backstop funding (§2) depend on EXTERNAL Blend testnet state (factory interface,
# BLND/USDC faucet, Comet LP mint) — those steps are emitted as the exact command
# sequence to run with blend-utils, guarded so a partial run never looks complete.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

NET="testnet"; WASM_DIR="target/wasm"
# ── Blend V2 testnet (verified) ────────────────────────────────────────────────
POOL_FACTORY="CDV6RX4CGPCOKGTBFS52V3LMWQGZN3LCQTXF5RVPOOCG4XVMHXQ4NTF6"
BACKSTOP="CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA"
BLND="CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF"
BLEND_USDC="CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU"
COMET_LP="CA5UTUUPHYL5K22UBRUVC37EARZUGYOSGK3IKIXG2JLCC5ZZLI4BDWDM"
SCALE=1000000000000                      # 1.0 at 12 dp (blend-price-adapter decimals)
C_FACTOR=7000000                          # 0.70 collateral factor, 7-dec (conservative)

[ -f deploy.env ] && set -a && . ./deploy.env && set +a || true
ADMIN="${ADMIN_ALIAS:?set ADMIN_ALIAS}"
VAULT="${VAULT:?set VAULT (deployed vault / ldLEOD token id)}"

log(){ printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
inv(){ stellar contract invoke --id "$1" --source "$ADMIN" --network "$NET" -- "${@:2}"; }
CID(){ awk 'NF{l=$0} END{print l}' | tr -d '"'; }
ADMIN_G="$(stellar keys address "$ADMIN")"

# ── §1 · blend-price-adapter (runs fully) ──────────────────────────────────────
log "Deploy + init blend-price-adapter"
BPA=$(stellar contract deploy --wasm "$WASM_DIR/blend_price_adapter.wasm" \
  --source "$ADMIN" --network "$NET" -- init --admin "$ADMIN_G" | CID)
echo "  blend-price-adapter = $BPA"

log "Register price sources: ldLEOD ← vault.share_price ; USDC ← pinned \$1"
inv "$BPA" set_vault_source --asset "$VAULT" --vault "$VAULT" >/dev/null
inv "$BPA" set_fixed_source --asset "$BLEND_USDC" --price "$SCALE" >/dev/null

log "Verify the adapter prices the ld-share (fail-closed live read)"
PRICE=$(inv "$BPA" lastprice --asset "{\"Stellar\":\"$VAULT\"}")
echo "  lastprice(ldLEOD) → $PRICE"
echo "$PRICE" | grep -q '"price"' \
  && echo "  ✓ Blend can now value ldLEOD collateral via this oracle" \
  || { echo "  ✗ adapter returned None — is the vault's oracle live?"; exit 1; }

# ── §2 · Blend pool (needs external testnet state; emit exact runbook) ──────────
log "Blend V2 pool creation — run with blend-utils against the verified addresses"
cat <<EON
  Pool factory : $POOL_FACTORY
  Backstop     : $BACKSTOP   (token = Comet BLND:USDC LP $COMET_LP)
  Reserves     : ldLEOD ($VAULT) c_factor=$C_FACTOR  +  USDC ($BLEND_USDC)
  Oracle       : $BPA   ⚠ immutable after pool creation (INTEGRATIONS/blend.md)

  1. Deploy pool via factory (name, oracle=$BPA, backstop_take_rate, max_positions).
  2. queue_set_reserve for ldLEOD (c_factor=$C_FACTOR) and USDC; set_reserve after.
  3. Fund backstop past the activation threshold (product constant 200,000):
        faucet BLND + USDC  →  mint Comet LP ($COMET_LP)  →  backstop.deposit
     then pool status Setup → Active.
  4. Borrow flow (via @blend-capital/blend-sdk, pinned v3.3.0):
        pool.submit({ from, spender, to, requests: [
          { request_type: 2 /*SupplyCollateral*/, address: '$VAULT',       amount },
          { request_type: 4 /*Borrow*/,           address: '$BLEND_USDC',  amount } ] })
  5. Record the pool id + tx hashes in INTEGRATIONS/blend.md.
EON
echo
echo "BLEND_PRICE_ADAPTER=$BPA  # add to deploy.env"
