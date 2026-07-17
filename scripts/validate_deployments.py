#!/usr/bin/env python3
"""Validate deployments/*.json (D2): required fields, Stellar address shapes, and
no-orphan (every registered contract has a matching explorer link). Run in CI and
in the release workflow. Exit non-zero on any problem."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEPLOY_DIR = ROOT / "deployments"

# Stellar contract ids are strkey 'C…' (56 chars); accounts are 'G…' (56).
CID = re.compile(r"^C[A-Z2-7]{55}$")
GID = re.compile(r"^G[A-Z2-7]{55}$")

REQUIRED_TOP = ["network", "deployed_at", "deployer", "contracts"]
REQUIRED_CONTRACTS = [
    "leod_sac",
    "usdc_sac",
    "mock_oracle",
    "oracle_adapter",
    "vault_factory",
    "vault",
    "mini_pool",
]


def err(msgs: list[str], f: Path, m: str) -> None:
    msgs.append(f"{f.name}: {m}")


def validate(f: Path) -> list[str]:
    msgs: list[str] = []
    try:
        doc = json.loads(f.read_text())
    except Exception as e:  # noqa: BLE001
        return [f"{f.name}: invalid JSON — {e}"]

    for k in REQUIRED_TOP:
        if k not in doc:
            err(msgs, f, f"missing top-level key '{k}'")

    if not GID.match(str(doc.get("deployer", ""))):
        err(msgs, f, f"deployer is not a valid G-address: {doc.get('deployer')!r}")

    contracts = doc.get("contracts", {})
    for name in REQUIRED_CONTRACTS:
        addr = contracts.get(name)
        if not addr:
            err(msgs, f, f"contracts.{name} missing")
        elif not CID.match(addr):
            err(msgs, f, f"contracts.{name} is not a valid C-address: {addr!r}")

    # no-orphan: every contract has an explorer entry, and vice versa.
    explorer = doc.get("explorer", {})
    if explorer:
        for name in contracts:
            if name not in explorer:
                err(msgs, f, f"orphan: contracts.{name} has no explorer link")
        for name in explorer:
            if name not in contracts:
                err(msgs, f, f"orphan: explorer.{name} has no contract")

    return msgs


def main() -> int:
    files = sorted(DEPLOY_DIR.glob("*.json"))
    if not files:
        print("no deployments/*.json found — nothing to validate (ok)")
        return 0
    all_msgs: list[str] = []
    for f in files:
        all_msgs += validate(f)
    if all_msgs:
        print("deployment registry INVALID:")
        for m in all_msgs:
            print(f"  ✗ {m}")
        return 1
    print(f"deployment registries valid: {', '.join(f.name for f in files)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
