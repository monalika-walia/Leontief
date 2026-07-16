# Leontief

Leontief is an adapter layer, not another lending protocol.

It converts tokenized real-world assets on Stellar — restricted, rebasing, price-accruing — into composable, yield-passing **ld-share** vault tokens that move through Blend, Aquarius, and any Soroban protocol, with a fail-closed NAV oracle and permissioned liquidation designed for regulated assets.

## Documents

| Doc | Purpose |
|---|---|
| [leontief-prototype-spec.md](leontief-prototype-spec.md) | **Frozen** technical spec for the testnet prototype |
| [leontief-docs-hub.md](leontief-docs-hub.md) | Unified documentation hub (GitBook seed): architecture, threat model, runbooks |
| [leontief-business-plan.md](leontief-business-plan.md) | Business plan v1.0 |
| [leontief-build-prompts.md](leontief-build-prompts.md) | Phased build plan (E→C→D→A→X→S), one prompt = one PR |
| [CLAUDE.md](CLAUDE.md) | Binding repo rules for every AI-assisted session |
| [DECISIONS.md](DECISIONS.md) | Append-only decision log (audit input) |

## Layout

```
contracts/   vault · vault-factory · oracle-adapter · mock-oracle · mini-pool
app/         React dApp
packages/    sdk · bindings
services/    indexer
scripts/     install_tools.sh · setup_testnet.sh · demo.sh
tests/       integration beats 1..5b
```

## Quickstart

```sh
./scripts/install_tools.sh   # toolchain (Rust, stellar-cli, just, …)
just setup                   # workspace deps
just test                    # full test suite
```

## License

Apache-2.0 (contracts, workspace) — see [LICENSE](LICENSE) and NOTICE.
