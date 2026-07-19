#!/usr/bin/env bash
# create_aqua_pool.sh — X3: create an Aquarius ldLEOD/USDC pool on testnet and seed
# minimal liquidity, exercising the composability of the ld-share as an LP asset.
#
# Verified (INTEGRATIONS/aquarius.md, 2026-07-17): permissionless pool creation is
# live; the testnet AMM router is CBCFTQSP… (docs-current, labeled valid across
# testnet resets) — but that address is DOCS-sourced, NOT on-chain-confirmed here,
# and the exact pool-creation entry point (init_standard_pool / init_stableswap_pool)
# is UNCITED. So this script FIRST smoke-tests the router on-chain, and only then
# emits the create/seed sequence. Fallback: classic SDEX for the share (documented,
# not the product).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

NET="testnet"
AQUA_ROUTER="${AQUA_ROUTER:-CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD}"

[ -f deploy.env ] && set -a && . ./deploy.env && set +a || true
ADMIN="${ADMIN_ALIAS:?set ADMIN_ALIAS}"
VAULT="${VAULT:?set VAULT (ldLEOD token id)}"
USDC_SAC="${USDC_SAC:?set USDC_SAC (test-USDC SAC id)}"

log(){ printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

log "Smoke-test the router on-chain BEFORE trusting the docs address"
if stellar contract invoke --id "$AQUA_ROUTER" --source "$ADMIN" --network "$NET" \
     -- --help >/dev/null 2>&1 \
   || stellar contract info interface --id "$AQUA_ROUTER" --network "$NET" >/dev/null 2>&1; then
  echo "  ✓ router $AQUA_ROUTER resolves on testnet"
else
  cat <<EOF
  ✗ router $AQUA_ROUTER did NOT resolve on testnet.
    Testnet resets wipe addresses (2–4×/yr). Re-fetch the current router from
    https://docs.aqua.network/user-guides/pools/creating-a-pool.md, set AQUA_ROUTER=,
    and re-run. If Soroban AMM is unavailable, use the SDEX fallback below.
EOF
  exit 1
fi

log "Inspect the router interface to confirm the pool-creation entry point"
echo "  (signature is UNCITED in research — confirm against the live interface)"
stellar contract info interface --id "$AQUA_ROUTER" --network "$NET" 2>/dev/null \
  | grep -iE "init.*pool|deposit|swap|withdraw" | head -12 \
  || echo "  (interface fetch unavailable — use @aquariusdefi/sdk to introspect)"

cat <<EON

Create + seed (fill the confirmed signature from the interface above):
  TOKENS: ldLEOD=$VAULT  USDC=$USDC_SAC  (Aquarius orders token addresses)
  1. Create a stableswap pool (both legs ≈ \$1) or 0.3% volatile pool via the router.
  2. deposit(user, [ldLEOD,USDC], pool_index, desired_amounts, min_shares) to seed.
  3. Record pool id + tx hashes in INTEGRATIONS/aquarius.md; wire the dApp
     "Provide liquidity" flow (behind a flag) via @aquariusdefi/sdk (@stellar/stellar-sdk ^15).

Fallback (if Soroban AMM is blocked on testnet) — classic SDEX, documented as a
fallback, not the product:
  stellar tx new manage-sell-offer --source-account $ADMIN --network $NET \\
    --selling <ldLEOD-classic-asset> --buying <USDC-asset> --amount <a> --price <p>
EON
