# CLAUDE.md — Leontief repo rules (binding for every session)
Read `leontief-prototype-spec.md` (FROZEN) and `leontief-docs-hub.md` before any change.

## Network facts (stable — do not "update" these)
- Testnet RPC: https://soroban-testnet.stellar.org
- Testnet Horizon: https://horizon-testnet.stellar.org · Friendbot: https://friendbot.stellar.org
- Testnet passphrase: "Test SDF Network ; September 2015"
- Mainnet passphrase: "Public Global Stellar Network ; September 2015"
- Mainnet RPC: provider chosen in DECISIONS.md (never hardcode; read from env)

## Non-negotiables
- Rust + soroban-sdk pinned (rust-toolchain.toml + Cargo.lock). Never bump unasked.
- i128 checked math only. Rounding: floor→user, ceil→protocol. VIRT=10^3 both mint/redeem legs. SCALE=10^12.
- Balance-diff measurement around every transfer-in. No trusting caller amounts.
- Oracle policy FAIL-CLOSED (spec §5). No fallback prices, no silent staleness.
- require_auth on every state-changing entry point. Typed errors; no panic/unwrap reachable from user input.
- Storage discipline: instance storage = config/admin only; persistent = balances/positions/registry;
  temporary = nothing user-owned. Every persistent write path calls extend_ttl (threshold/extend values
  from constants.rs; verify current network TTL limits with stellar-cli at kickoff and record).
- Exits (withdraw/repay) are NEVER pausable. Do not "improve" this.
- Every PR: `just check` green (fmt, clippy -D warnings, tests, coverage gate ≥90% vault+mini-pool).
- Version-volatile ecosystem facts (SDK versions, Reflector feed IDs, Blend params) live in
  `INTEGRATIONS/*.md` + `deployments/*.json`, sourced from official docs, dated, and cited. Never from memory.
- Conventional commits; PR description notes AI assistance + spec sections touched.
- Commits are authored solely by the human team member of record — no AI co-author trailers, ever.
