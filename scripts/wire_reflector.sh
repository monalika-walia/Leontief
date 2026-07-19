#!/usr/bin/env bash
# wire_reflector.sh — X1: point the fail-closed oracle-adapter at a LIVE Reflector
# SEP-40 feed on testnet, via the reflector-feed shim, and prove a real read.
#
# No RWA feed exists on Reflector testnet (INTEGRATIONS/reflector.md), so we wire
# the demonstrator asset XLM (present on the CEX/DEX feed) to show the live-oracle
# path end-to-end: deploy shim → map XLM → adapter reads live price → deviation
# drill. The RWA NAV (LEOD) stays on the mock until a mainnet feed exists.
#
# Prereqs: `source deploy.env` (needs ADMIN_ALIAS + ORACLE_ADAPTER) OR pass them in.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

NET="testnet"
WASM_DIR="target/wasm"
# Reflector External CEX/DEX feed, testnet (INTEGRATIONS/reflector.md, live-verified).
REFLECTOR_CEXDEX="CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63"
DEMO_SYMBOL="${DEMO_SYMBOL:-XLM}"          # an asset that actually exists on testnet
SOURCE_DECIMALS=14                          # Reflector price decimals (live-verified)
MAX_AGE=750                                 # cadence(300s) × 2.5 (fail-closed staleness)

[ -f deploy.env ] && set -a && . ./deploy.env && set +a || true
ADMIN="${ADMIN_ALIAS:?set ADMIN_ALIAS (a funded testnet key alias)}"
ADAPTER="${ORACLE_ADAPTER:?set ORACLE_ADAPTER (deployed oracle-adapter id)}"

log(){ printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
inv(){ stellar contract invoke --id "$1" --source "$ADMIN" --network "$NET" -- "${@:2}"; }
CID(){ awk 'NF{l=$0} END{print l}' | tr -d '"'; }

log "Deploy reflector-feed shim → live Reflector CEX/DEX feed"
SHIM=$(stellar contract deploy --wasm "$WASM_DIR/reflector_feed.wasm" \
  --source "$ADMIN" --network "$NET" -- \
  init --admin "$(stellar keys address "$ADMIN")" --oracle "$REFLECTOR_CEXDEX" | CID)
echo "  shim = $SHIM"

log "Map $DEMO_SYMBOL → Reflector Asset::Other($DEMO_SYMBOL)"
inv "$SHIM" map_asset --our_symbol "$DEMO_SYMBOL" \
  --reflector_asset "{\"Other\":\"$DEMO_SYMBOL\"}" >/dev/null

log "Configure adapter feed: $DEMO_SYMBOL ← shim (source_decimals=$SOURCE_DECIMALS, max_age=${MAX_AGE}s)"
inv "$ADAPTER" configure_feed --asset "$DEMO_SYMBOL" --source "$SHIM" \
  --source_decimals "$SOURCE_DECIMALS" >/dev/null
inv "$ADAPTER" set_bounds --asset "$DEMO_SYMBOL" --max_age_secs "$MAX_AGE" --max_dev_bps 5000 >/dev/null

log "LIVE read: adapter.get_nav($DEMO_SYMBOL) — a real Reflector price, normalized to SCALE"
NAV=$(inv "$ADAPTER" get_nav --asset "$DEMO_SYMBOL")
echo "  get_nav → $NAV"
echo "$NAV" | grep -q '"nav"' && echo "  ✓ live Reflector NAV consumed through the fail-closed adapter"

cat <<EON

Next (deviation-breaker drill, record tx hashes in INTEGRATIONS/reflector.md):
  # tighten the bound so the next tick trips the breaker:
  stellar contract invoke --id $ADAPTER --source $ADMIN --network $NET -- \\
    set_bounds --asset $DEMO_SYMBOL --max_age_secs $MAX_AGE --max_dev_bps 1
  # observe DeviationExceeded on the next get_nav (fail-closed halt), then re-arm:
  #   accept_override --asset $DEMO_SYMBOL --nav <fresh_scaled_nav>
EON
echo "SHIM=$SHIM  # reflector-feed shim (add to deploy.env)"
