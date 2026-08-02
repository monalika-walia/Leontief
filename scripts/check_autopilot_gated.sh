#!/usr/bin/env bash
# check_autopilot_gated.sh — A8 Tier 2 guardrails, enforced mechanically.
#
# Autopilot is the only thing in this repo that signs on a user's behalf, so the
# two switches that keep it contained are asserted in CI rather than trusted:
#
#   1. the engine refuses to run unless AUTOPILOT_FLAG=true  (never on by default)
#   2. the engine refuses to run on any network but testnet   (mainnet needs an
#      audit and human sign-off — DECISIONS #12)
#
# Also checks that the app's Autopilot panel is testnet-gated, and that no
# session SECRET is ever persisted server-side.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
note() { printf '  %s\n' "$*"; }

# 1 · engine off unless flagged
if grep -q 'AUTOPILOT_FLAG' "$ROOT/services/autopilot/src/config.ts" &&
   grep -q 'enabled' "$ROOT/services/autopilot/src/index.ts"; then
  note "✓ engine is flag-gated (AUTOPILOT_FLAG)"
else
  echo "✗ engine is missing its AUTOPILOT_FLAG gate"; fail=1
fi

# 2 · engine is testnet-only
if grep -q 'refusing to run outside testnet' "$ROOT/services/autopilot/src/config.ts" &&
   grep -q 'TESTNET-only' "$ROOT/services/autopilot/src/signer.ts"; then
  note "✓ engine and signer assert testnet"
else
  echo "✗ engine is missing its testnet assertion"; fail=1
fi

# 3 · the HF floor has no override
if grep -qE 'HF_FLOOR = \(SCALE \* 16n\) / 10n' "$ROOT/services/autopilot/src/policy.ts"; then
  note "✓ health-factor floor is 1.6"
else
  echo "✗ the 1.6 health-factor floor is missing or altered"; fail=1
fi
# Identifier-shaped only: the file is allowed to SAY "there is no override flag",
# it is not allowed to have one. Strip full-line comments before matching.
if sed -E 's@^[[:space:]]*(//|/\*|\*).*$@@' "$ROOT/services/autopilot/src/policy.ts" |
   grep -qiE '\b(override|bypass|force)[A-Za-z]*\b'; then
  echo "✗ policy.ts contains an override/bypass identifier — the floor must have none"; fail=1
else
  note "✓ the floor has no override path"
fi

# 4 · app panel is testnet-gated
if grep -q 'Autopilot is testnet-only' "$ROOT/app/src/routes/Autopilot.tsx"; then
  note "✓ app panel refuses to render off testnet"
else
  echo "✗ the app's Autopilot panel is not testnet-gated"; fail=1
fi

# 5 · no server-side column or field could hold a session SECRET
if grep -rnE 'session_secret|sessionSecret' "$ROOT/services/indexer/src" "$ROOT/services/autopilot/src/db.ts" 2>/dev/null; then
  echo "✗ a session secret is being persisted server-side"; fail=1
else
  note "✓ no session secret is persisted (public key only)"
fi

[ "$fail" -eq 0 ] && echo "✓ autopilot guardrails intact"
exit "$fail"
