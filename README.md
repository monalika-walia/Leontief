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
services/    indexer · api · monitor · bot · autopilot
scripts/     install_tools.sh · setup_testnet.sh · demo.sh
tests/       integration beats 1..5b
```

## Agents, bots, and automation — where the line is

Three surfaces in this repo touch automation. They are deliberately not equal:

| Surface | Signs? | Status |
|---|---|---|
| [`packages/sdk/examples/agent-treasury.ts`](packages/sdk/examples/agent-treasury.ts) (A7) | its own throwaway testnet key | demo script |
| [`services/bot`](services/bot) (A8 Tier 1) | **never — no signing capability at all**, proven in CI | shipping to the beta |
| [`services/autopilot`](services/autopilot) (A8 Tier 2) | on a user's behalf, via a revocable session signer | **off by default, testnet only** |

The agent-treasury example is a **policy loop, not an LLM** — a plain Stellar
keypair plus scripted rules. **This pattern requires human sign-off before any
mainnet use**; nothing in it is audited for production.

**Mainnet Autopilot requires an audit and human sign-off. Full stop.** The engine
refuses to start on any network but testnet, is never enabled by default, and its
guardrails are asserted in CI. What a grant does and does not constrain is written
plainly in [`INTEGRATIONS/delegated-auth.md`](INTEGRATIONS/delegated-auth.md) and
DECISIONS #11 — including the part where a classic Stellar signer is not
scope-limited, so the engine-side policy is the real leash.

## Quickstart

```sh
./scripts/install_tools.sh   # toolchain (Rust, stellar-cli, just, …)
just setup                   # workspace deps
just test                    # full test suite
```

## License

Apache-2.0 (contracts, workspace) — see [LICENSE](LICENSE) and NOTICE.
