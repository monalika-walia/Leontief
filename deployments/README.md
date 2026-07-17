# deployments/

Address registry written by deploy scripts (Phase D1/D2), one JSON per network.
Schema per entry: `{contract, address, wasm_hash, tag, deployed_at, deployer, tx}`.
`docs/ADDRESSES.md` is generated from these files (`just docs`). Validated in CI (D2).
