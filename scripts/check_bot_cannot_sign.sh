#!/usr/bin/env bash
# check_bot_cannot_sign.sh — the A8 Tier 1 hard rule, enforced mechanically.
#
# "The bot NEVER receives, stores, or requests a secret key or seed phrase — not
#  'encrypted', not 'temporarily', not ever. Tier 1 has no signing capability at
#  all."
#
# This is a grep, so it is a backstop, not a proof: the real guarantee is
# structural (services/bot/src/chain.ts exposes reads only, and the SDK's write
# methods are unreachable without a Signer, which the service never constructs).
# But a grep catches the commit that would quietly change that, which is the
# failure mode worth automating.
#
# Comment lines are stripped before matching, so the bot can still TALK about
# keys — its anti-phishing copy has to say the word "secret key" out loud — while
# any identifier that could handle one fails the build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$ROOT/services/bot/src}"

# Identifier-shaped only: prose like "never ask for your secret key" is fine,
# `secretKey` / `Keypair` / `.sign(` is not.
FORBIDDEN='Keypair|keypairSigner|fromSecret|signTransaction|signAuthEntry|secretKey|SECRET_KEY|PRIVATE_KEY|mnemonic|\.sign\(|\bSigner\b|_SK\b'
# Every state-changing method on the SDK client. Reads are the whole job here.
WRITES='\.(wrap|unwrap|supplyCollateral|withdrawCollateral|borrow|repay|liquidate|transfer)\('

# Drop full-line comments (`//…`, `/*…`, ` *…`) before matching.
code_of() { sed -E 's@^[[:space:]]*(//|/\*|\*).*$@@' "$1"; }

fail=0
check() { # check <regex> <human label>
  local hits=""
  while IFS= read -r file; do
    local m
    m=$(code_of "$file" | grep -nE "$1" | sed "s@^@${file#"$ROOT/"}:@") || true
    [ -n "$m" ] && hits+="$m"$'\n'
  done < <(find "$TARGET" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' \))
  if [ -n "$hits" ]; then
    echo "✗ $2:"
    printf '%s' "$hits"
    fail=1
  fi
}

check "$FORBIDDEN" "signing-capable code found in the Telegram bot"
check "$WRITES" "protocol write call found in the Telegram bot"

if [ "$fail" -eq 0 ]; then
  echo "✓ services/bot: no signing capability, no protocol writes"
fi
exit "$fail"
