# Contributing

Leontief is built by a three-person protocol team (Monalika · Aditya · Vyom,
incubated by 29Projects Lab) and welcomes outside contributions once the SCF
prototype phase settles. Until then, issues and small PRs are appreciated;
larger changes should start with an issue.

## Ground rules (binding — see `CLAUDE.md` in the repo)

- Read `leontief-prototype-spec.md` (**frozen**) and `leontief-docs-hub.md`
  before any change. Deviations from spec §3 math, §5 oracle policy, or §7
  security checklist require a human-authored `DECISIONS.md` entry.
- Rust + soroban-sdk are pinned; never bump unasked. `i128` checked math only;
  floor→user, ceil→protocol; balance-diff around every transfer-in.
- **Exits (withdraw/repay) are never pausable.** Do not "improve" this.
- Every PR: `just check` green — fmt, clippy `-D warnings`, tests, coverage
  ≥90% on vault + mini-pool. Red CI never merges.
- Conventional commits. PRs note AI assistance and spec sections touched.
  Commits are authored solely by the human of record — no AI co-author trailers.

## Getting started

```sh
./scripts/install_tools.sh   # toolchain (Rust, stellar-cli, just, …)
just setup && just test      # workspace + full suite
just demo-local              # the six beats, locally
```

Licensing: contracts Apache-2.0 · SDK/indexer MIT · docs CC-BY-4.0.
