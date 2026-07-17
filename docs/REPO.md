# Repository conventions

## Branch protection (configure on GitHub → Settings → Branches → `main`)

- Require a pull request before merging (≥1 review once the team is ≥2 active committers).
- Required status checks: **fmt · clippy · test · coverage · wasm · js** (the `CI` workflow jobs).
- Require branches to be up to date before merging; no force pushes; no deletions.
- Red CI never merges — no admin bypass for failing checks.

> Solo-bootstrap note: while the repo has a single active committer, direct commits to `main`
> are used with the same conventional-commit + green-`just check` discipline; branch protection
> with required PRs turns on as soon as a second committer lands (spec §0 requires PR flow).

## Commits

- Conventional commits (`feat(vault): …`, `fix(oracle-adapter): …`, `docs: …`, `ci: …`).
- Authored solely by the human team member of record — **no AI co-author trailers, ever**.
- PR descriptions note AI assistance + spec sections touched (template enforces).

## CI map

| Job | Gate |
|---|---|
| fmt | `cargo fmt --all -- --check` |
| clippy | `-D warnings`, all targets |
| test | `cargo test --workspace --all-targets` |
| coverage | `cargo llvm-cov -p vault -p mini-pool --fail-under-lines 90` + HTML artifact |
| wasm | `stellar contract build` + `optimize` each contract; artifacts + SHA256SUMS |
| js | `pnpm install` → biome ci → vitest |
| nightly | 1 h fuzz per target (once C8 lands) + indexer image build (once A3 lands) |

## Releases (Phase D2)

Tag `v*` → build + optimize wasm → SHA256SUMS → GitHub Release; `deployments/*.json` is the
address registry consumed by `docs/ADDRESSES.md`.
