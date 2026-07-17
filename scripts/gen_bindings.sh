#!/usr/bin/env bash
# gen_bindings.sh — generate typed TypeScript clients from the LIVE testnet
# contracts (A1). Output goes to packages/bindings/<name>/ (gitignored —
# regenerate after every deploy; the hand-written @leontief/sdk is the stable,
# committed layer on top).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

REG="deployments/testnet.json"
[ -f "$REG" ] || { echo "no $REG — run scripts/setup_testnet.sh first"; exit 1; }

id_of() { python3 -c "import json;print(json.load(open('$REG'))['contracts']['$1'])"; }

for pair in "vault:vault" "vault_factory:vault-factory" "oracle_adapter:oracle-adapter" "mini_pool:mini-pool"; do
  key="${pair%%:*}"; name="${pair##*:}"
  cid=$(id_of "$key")
  echo "▸ bindings for $name ($cid)"
  stellar contract bindings typescript \
    --network testnet \
    --contract-id "$cid" \
    --output-dir "packages/bindings/$name" \
    --overwrite >/dev/null
done
echo "done — packages/bindings/{vault,vault-factory,oracle-adapter,mini-pool}"
