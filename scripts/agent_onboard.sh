#!/usr/bin/env bash
# agent_onboard.sh — onboard a fresh "agent" account for the A7 agent-treasury
# demo (packages/sdk/examples/agent-treasury.ts).
#
# WHY THIS IS A SEPARATE SCRIPT: the mirror asset is a genuine SEP-8 asset
# (auth_required | auth_revocable), so holding it needs a trustline plus an
# ISSUER authorization. That is a compliance/onboarding step performed by the
# issuer — not something an autonomous treasury does for itself, and not
# something the Leontief SDK should be able to do. The demo loop starts after
# this line and touches only the public SDK.
#
#   source deploy.env && ./scripts/agent_onboard.sh      # → appends AGENT/AGENT_SK
#
# Re-running with AGENT_SK already exported reuses that account (idempotent
# trustline + authorize); otherwise a fresh testnet keypair is generated.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

ENV_FILE="${1:-deploy.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"
# deploy.env exports STELLAR_RPC_URL/STELLAR_NETWORK for the app; they conflict
# with `--network testnet` in stellar-cli (see demo.sh).
unset STELLAR_RPC_URL STELLAR_NETWORK STELLAR_NETWORK_PASSPHRASE

NET="testnet"
[ -n "${ISSUER:-}" ] && [ -n "${ADMIN:-}" ] || { echo "source deploy.env first" >&2; exit 2; }

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

LEOD_ASSET="LEOD:$ISSUER"
USDC_ASSET="USDC:$ADMIN"
A_ISSUER="issuer_${ALIAS_SUFFIX}"

log "1 · Agent keypair"
if [ -n "${AGENT_SK:-}" ]; then
  # Reuse the recorded agent (idempotent re-run).
  ALIAS="agent_${ALIAS_SUFFIX}"
  stellar keys add "$ALIAS" --secret-key <<<"$AGENT_SK" >/dev/null 2>&1 || true
  AGENT="$(stellar keys address "$ALIAS")"
  note "reusing $AGENT"
else
  # Fresh agent: a unique alias, so a repeat run never silently resurrects the
  # previous demo account (which would start with a warm balance).
  ALIAS="agent_${ALIAS_SUFFIX}_$(head -c3 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  stellar keys generate "$ALIAS" --network "$NET" --fund >/dev/null 2>&1 ||
    for _ in 1 2 3 4 5; do stellar keys fund "$ALIAS" --network "$NET" >/dev/null 2>&1 && break; sleep 2; done
  AGENT="$(stellar keys address "$ALIAS")"
  AGENT_SK="$(stellar keys show "$ALIAS")"
  note "generated $AGENT"
fi

log "2 · Trustlines (LEOD mirror + USDC revenue asset)"
for line in "$LEOD_ASSET" "$USDC_ASSET"; do
  stellar tx new change-trust --source-account "$ALIAS" --network "$NET" --line "$line" --fee 1000 >/dev/null
done
note "trustlines set"

log "3 · ISSUER authorizes the agent to hold the restricted mirror asset (SEP-8)"
stellar tx new set-trustline-flags --source-account "$A_ISSUER" --network "$NET" \
  --trustor "$AGENT" --asset "$LEOD_ASSET" --set-authorize --fee 1000 >/dev/null
note "authorized — this is the issuer's decision, not the agent's"

log "4 · Recording AGENT/AGENT_SK in $ENV_FILE"
grep -v -E '^export (AGENT|AGENT_SK)=' "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
{
  echo "# Agent-treasury demo (A7) account — throwaway TESTNET key, gitignored."
  echo "export AGENT=$AGENT"
  echo "export AGENT_SK=$AGENT_SK"
} >> "$ENV_FILE"
note "done — now: source $ENV_FILE && pnpm exec tsx packages/sdk/examples/agent-treasury.ts"
