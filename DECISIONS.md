# DECISIONS.md — Leontief decision log

Append-only. Entry = date · author (human) · decision · alternatives · spec sections affected · test impact.
Required for any deviation from frozen spec §3 math, §5 oracle policy, §7 security checklist.
This file is an audit input and part of the AI-assistance discipline (every AI-assisted deviation gets a human-authored entry).

---

## #1 · 2026-07-16 · monalika walia · Toolchain baseline

- **Decision:** pin `rustc 1.97.1` (stable) + `soroban-sdk 27.0.0` + wasm target `wasm32v1-none`; `stellar-cli 27.0.0` (testnet protocol 27, verified live). TTL constants derived from testnet state-archival settings fetched 2026-07-16 via `stellar network settings`: `max_entry_ttl = 3_110_400`, `min_persistent_ttl = 120_960` → contracts extend persistent entries to the max when < `518_400` ledgers (~30 d) remain.
- **Alternatives:** older sdk 23.x (LTS-ish, but CLI 27 conventions and testnet protocol 27 make 27.0.0 the coherent pair); `wasm32-unknown-unknown` (only for pre-23 SDKs).
- **Spec sections affected:** §1 (toolchain pin). No math/policy deviation.
- **Test impact:** none — establishes the baseline all tests run on.
- *AI-assisted session; entry reviewed by the human author of record.*
