#!/usr/bin/env bash
# gen_addresses.sh — regenerate docs/ADDRESSES.md from deployments/*.json (D2).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

python3 - <<'PY'
import json, glob, os

rows = []
out = ["# docs/ADDRESSES.md",
       "",
       "> Auto-generated from `deployments/*.json` by `scripts/gen_addresses.sh`",
       "> (`just docs`). Do not hand-edit.",
       ""]

for path in sorted(glob.glob("deployments/*.json")):
    doc = json.load(open(path))
    net = doc.get("network", os.path.basename(path))
    out += [f"## {net}", ""]
    out += [f"- Deployed: `{doc.get('deployed_at','?')}` · deployer `{doc.get('deployer','?')}`"]
    if doc.get("issuer"):
        out += [f"- LEOD issuer: `{doc['issuer']}`"]
    if doc.get("vault_wasm_hash"):
        out += [f"- Vault wasm hash: `{doc['vault_wasm_hash']}`"]
    out += ["", "| Contract | Address | Explorer |", "|---|---|---|"]
    explorer = doc.get("explorer", {})
    for name, addr in doc.get("contracts", {}).items():
        link = explorer.get(name, "")
        cell = f"[{addr[:6]}…{addr[-4:]}]({link})" if link else f"`{addr}`"
        out += [f"| {name} | `{addr}` | {cell} |"]
    out += [""]

open("docs/ADDRESSES.md", "w").write("\n".join(out) + "\n")
print("wrote docs/ADDRESSES.md")
PY
