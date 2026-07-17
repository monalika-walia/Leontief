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

## #2 · 2026-07-16 · monalika walia · `oracle-adapter.accept_override` is prototype-only

- **Decision:** the adapter ships an admin `accept_override(asset, nav)` that re-arms a halted
  feed by planting a new `last_accepted`. It exists so testnet drills (deviation breaker, X1)
  can recover without redeploys. It emits the loud `override_accepted` event that monitoring
  (D4) treats as an incident. At mainnet this function is exercised only via the 2-of-3
  multisig (D3) and is a candidate for removal/timelocking at Tranche 3.
- **Alternatives:** no override (halted feed requires redeploy — unacceptable for drills);
  automatic re-arm after N hours (violates fail-closed: silent recovery is a fallback price).
- **Spec sections affected:** §5 (explicitly allows it, "prototype-only escape hatch").
- **Test impact:** `override_rearms_after_deviation_halt`, `override_rejects_nonpositive_and_unconfigured`.
- *AI-assisted session; entry reviewed by the human author of record.*

## #5 · 2026-07-17 · monalika walia · Hosting: Vercel (front-ends) + Render (API/Postgres); MVP skips multisig

- **Decision:** landing + litepaper + dApp are static on **Vercel** (team
  `29projectslab`, live at leontief-app / leontief-landing `.vercel.app`). The
  backend API + its Postgres go on **Render** via the committed `render.yaml`
  Blueprint (free plan, managed Postgres, migration as pre-deploy). Monitoring is
  a standalone `services/monitor` (reads contracts directly, Discord + Healthchecks
  sinks) — no indexer dependency for the readable conditions. **D3 multisig admin
  handover is deliberately deferred for the MVP** (per team direction 2026-07-17);
  admin stays a single ephemeral testnet key. Re-instate before mainnet
  (docs/MULTISIG.md, docs/MAINNET.md).
- **Alternatives:** Railway/Fly for the API (Render chosen — first-class Postgres,
  no cold starts, IaC Blueprints, and a Claude Code + MCP integration path);
  Vercel serverless for the API (rejected — Fastify + long-lived Postgres pool fits
  a Render web service better).
- **Spec sections affected:** docs-hub §05 (ops/hosting); D3 (skipped for MVP), D4.
- **Test impact:** monitor smoke-verified against live testnet (0 alerts, healthy).
- *AI-assisted session; entry reviewed by the human author of record.*

## #6 · 2026-07-17 · monalika walia · Docs site: mdBook on GitHub Pages (GitBook fallback exercised)

- **Decision:** the public "unified source" (SCF requirement) is an **mdBook** site
  built from `docs-site/` and deployed to GitHub Pages by `.github/workflows/docs.yml`.
  Pages `{{#include}}` the canonical repo files (spec, docs-hub, DECISIONS,
  SECURITY-TESTING, ADDRESSES, runbooks) so there is exactly one source of truth;
  mermaid renders via mdbook-mermaid; CI link-checks the built site (lychee,
  offline) and fails on broken includes.
- **Alternatives:** GitBook (hosted) — needs an org account + OAuth setup we can't
  drive from CI, and duplicates content; a raw README index — fails the "unified
  source" bar. The build prompts explicitly allow "mdBook fallback → DECISIONS".
- **Spec sections affected:** none (S1 tooling choice).
- **Test impact:** docs workflow build + link-check gate.
- *AI-assisted session; entry reviewed by the human author of record.*

## #3 · 2026-07-16 · monalika walia · Vault mint/redeem legs are value-consistent (spec §3 ambiguity resolution) — ✅ APPROVED 2026-07-17

- **Decision:** spec §3 defines `V` in quote units (`balance·nav/SCALE`) but writes the mint leg
  as `shares = received·(S+VIRT)/(V+VIRT)` with `received` in underlying units. Taken literally,
  a depositor at NAV 1.02 silently loses ~2% of contributed value to prior holders, and the
  withdraw leg would emit quote units as if they were underlying units. We implement the only
  unit-consistent reading: `received` is valued at the current NAV
  (`value_in = received·nav/SCALE`, floor) before the share formula, and the withdraw leg
  converts the quote value back (`amount = value_out·SCALE/nav`, floor, clamped to holdings).
  Consequences: `share_price` is **quote units per share** (so beat 4's "NAV tick raises
  share_price" holds for accrual assets), and mini-pool valuation is
  `coll_value = shares·share_price/SCALE` — NAV enters exactly once (C5's prompt formula
  multiplies by nav a second time, which would double-count under this semantics).
- **Alternatives:** (1) literal formula — unit-inconsistent, unfair to depositors whenever
  nav ≠ 1.0, contradicts C8's NAV-parameterized golden vectors; (2) raw-unit legs with
  quote-only share_price reads — fair, and exits would not need the oracle, but then a pure
  NAV tick cannot move mint ratios and C8's "first deposit @ nav 1.0209" vector is vacuous.
- **Spec sections affected:** §3 (math), §6 (pool valuation unit trail), §8 beat 4.
- **Test impact:** golden vectors (C8) generated under this semantics; C3 property tests
  (fairness, round-trip ≤, inflation-attack bound) assert it. Note on the §3 inflation bound:
  with `VIRT = 10^3` the literal "victim loss < 1e-6" holds for front-run donations up to
  ~1e6 stroops; beyond that the enforced (and tested) guarantees are: zero-share mints REVERT
  (victim keeps funds), victim rounding loss ≤ one share's value, and the attacker's claim
  never exceeds their outlay — a strict-1e-6-for-all-donations bound would need `VIRT = 10^6`,
  which the frozen spec does not authorize.

## #4 · 2026-07-17 · monalika walia · Property-test case counts by cost class

- **Decision:** the build prompts call for "10k cases" on the accounting/liquidation properties.
  That count is honored for **pure-math** properties (oracle-adapter normalization round-trip runs
  10_000 cases — a pure function, sub-second). The **full-stack** properties (vault sequences,
  mini-pool liquidation rounding/termination) register the entire contract graph per case
  (~1.5 s/case), so a literal 10k run is ~4+ hours and unusable in CI. These read their count from
  `PROPTEST_CASES`, defaulting to 96 (vault) / 64 (mini-pool) on PR CI and 512 in the nightly
  workflow. The invariants are identical at every count; only sample density changes.
- **Alternatives:** literal 10k on every property (CI wall-clock hours — rejected); fixed low count
  with no nightly escalation (thinner tail coverage — rejected).
- **Spec sections affected:** none (test methodology; §7 coverage gate unaffected — still ≥90%).
- **Test impact:** also fixed a proptest reject-budget abort in the mini-pool suite — the NAV crash
  is now computed from the borrow (`crash_for_hf`) so every generated case is liquidatable, instead
  of filtering healthy cases with `prop_assume!` until the global-reject cap trips.
- *AI-assisted session; entry reviewed by the human author of record.*
- *AI-assisted analysis; **approved by the team on 2026-07-17** — this is the canonical §3 reading for spec freeze v1.1.*
