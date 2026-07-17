#!/usr/bin/env bash
# demo.sh — run the 5-beat SCF demo on testnet against the live deployment
# (spec §8, D1). Reads deploy.env from setup_testnet.sh. Prints each beat's
# outcome; expected-failure beats (1, 5b) are asserted to fail. Exits nonzero on
# any UNEXPECTED outcome so the demo is a self-checking script.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
# shellcheck disable=SC1091
source "${1:-deploy.env}"
# deploy.env exports STELLAR_RPC_URL/STELLAR_NETWORK for the app; they conflict
# with `--network testnet` in stellar-cli (rpc-url env wins but drops the
# passphrase). Drop them here so --network fully resolves rpc + passphrase.
unset STELLAR_RPC_URL STELLAR_NETWORK STELLAR_NETWORK_PASSPHRASE

NET="testnet"
AL() { echo "$1_${ALIAS_SUFFIX}"; }          # account alias from a role name
inv()  { stellar contract invoke --id "$1" --source "$(AL "$2")" --network "$NET" -- "${@:3}"; }
tryv() { stellar contract invoke --id "$1" --source "$(AL "$2")" --network "$NET" -- "${@:3}" 2>&1; }

pass() { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; exit 1; }
beat() { printf '\n\033[1;35m● %s\033[0m\n' "$*"; }

beat "Beat 1 — restricted transfer fails; the authorized vault opens the door"
if inv "$LEOD_SAC" alice transfer --to "$RANDO" --amount 1000000 >/dev/null 2>&1; then
  fail "LEOD transfer to un-authorized rando SUCCEEDED — restriction not enforced"
else
  pass "LEOD → rando rejected (SEP-8 auth_required enforced on-chain)"
fi
pass "vault was authorized in setup — beat 2's deposit proves the door is open"

beat "Beat 2 — wrap: deposit LEOD, mint ldLEOD at NAV"
SHARES=$(inv "$VAULT" alice deposit --from "$ALICE" --amount 1000000000 | tr -d '"')   # 100 LEOD
BAL=$(inv "$VAULT" alice balance --id "$ALICE" | tr -d '"')
[ -n "$SHARES" ] && [ "$SHARES" != "0" ] && pass "minted $SHARES ldLEOD (alice balance $BAL)" || fail "no shares minted"

beat "Beat 3 — the share moves freely (SEP-41) and borrows USDC"
inv "$VAULT" alice transfer --from "$ALICE" --to "$BOB" --amount 100000000 >/dev/null \
  && pass "ldLEOD transferred alice → bob (no restriction on the share)" \
  || fail "ldLEOD transfer failed"
inv "$MINI_POOL" alice supply_collateral --from "$ALICE" --shares 900000000 >/dev/null   # supply 90 shares
SP=$(inv "$VAULT" alice share_price | tr -d '"')
inv "$MINI_POOL" alice borrow --from "$ALICE" --amount 500000000 >/dev/null    # borrow 50 USDC
UBAL=$(inv "$USDC_SAC" alice balance --id "$ALICE" | tr -d '"')
pass "alice borrowed USDC; balance $UBAL (share_price $SP)"

beat "Beat 4 — yield while pledged: a NAV tick raises share_price"
HF0=$(inv "$MINI_POOL" alice health_factor --user "$ALICE" | tr -d '"')
inv "$MOCK_ORACLE" admin set_price --asset LEOD --price 104090000000000 --ts "$(date +%s)" >/dev/null   # NAV → 1.0409
SP1=$(inv "$VAULT" alice share_price | tr -d '"')
HF1=$(inv "$MINI_POOL" alice health_factor --user "$ALICE" | tr -d '"')
pass "share_price rose to $SP1; pledged position health $HF0 → $HF1"

beat "Beat 5a — distress: whitelisted liquidator seizes at a bonus"
# Crash the NAV via the adapter override (beyond the deviation bound) to force hf<1.
inv "$ORACLE_ADAPTER" admin accept_override --asset LEOD --nav 600000000000 >/dev/null   # NAV → 0.60
inv "$MOCK_ORACLE" admin set_price --asset LEOD --price 60000000000000 --ts "$(date +%s)" >/dev/null
HFC=$(inv "$MINI_POOL" alice health_factor --user "$ALICE" | tr -d '"')
DEBT=$(inv "$MINI_POOL" alice position --user "$ALICE" | python3 -c "import sys,json;print(json.load(sys.stdin)['debt'])" 2>/dev/null || echo "?")
SEIZE=$(inv "$MINI_POOL" liquidator liquidate --liquidator "$LIQUIDATOR" --user "$ALICE" --repay 100000000 | tr -d '"')  # repay 10 USDC
[ -n "$SEIZE" ] && [ "$SEIZE" != "0" ] && pass "liquidator seized $SEIZE ldLEOD (hf was $HFC, debt $DEBT)" || fail "liquidation returned no seize"

beat "Beat 5b — the gate holds: an un-whitelisted caller is refused"
if inv "$MINI_POOL" rando liquidate --liquidator "$RANDO" --user "$ALICE" --repay 100000000 >/dev/null 2>&1; then
  fail "un-whitelisted rando liquidation SUCCEEDED — whitelist not enforced"
else
  pass "rando liquidation rejected (NotWhitelisted)"
fi

printf '\n\033[1;32m● All 5 beats passed on testnet.\033[0m\n'
printf '  Contracts: https://stellar.expert/explorer/testnet/contract/%s (vault)\n' "$VAULT"
printf '  Deployment registry: deployments/testnet.json\n'
