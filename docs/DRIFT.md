# DRIFT.md — documentation drift audit

*Updated August 2026.* One row per discrepancy between {Build application, litepaper, docs hub,
live site}. Rows close only when the fix is merged/published. The empty-of-unresolved-rows state of
this table is the first acceptance check of the truth pass (Phase 7).

Truth hierarchy: **Build application** = tranche/budget truth · **Litepaper (v1.1)** = thesis truth
· **Docs hub** = the index binding everything. `leontief-prototype-spec.md` is frozen and never
rewritten; status lives beside it in [STATUS.md](./STATUS.md).

| # | Claim / item | Where stated | Where contradicted or missing | Fix | Status |
|---|---|---|---|---|---|
| 1 | Org framing: "Leontief is a Lemma Labs protocol (lemmalabs.space) — a Stellar-focused studio; Estonian OÜ registration in progress." | Litepaper v1.1, Build application | Litepaper HTML v1.0 footer + meta ("a 29Projects Lab protocol"); docusaurus footer; performance.html footer; `docs-site/src/contributing.md` ("incubated by 29Projects Lab"); `landing/README.md`; `scripts/record_demo.md` | Standardize the org line verbatim on every public page; historical `DECISIONS.md` entries stay as a log; superseding decision recorded | **Closed** — this pass |
| 2 | Roadmap statuses current (Phase 0 Complete · Phase 1 Live on testnet · Phase 2 In progress · 3–6 unchanged) | Litepaper v1.1 §9 | Litepaper HTML v1.0 roadmap (no statuses, stale 4-step framing); docs hub "Roadmap & Tranches"; "Reflector live" still future-tense in hub §Architecture | Litepaper §9 table propagated to the rendered litepaper; hub roadmap section points at litepaper §9 + application; Reflector moved to present tense everywhere | **Closed** — this pass |
| 3 | Telegram access layer / Autopilot / agent-treasury pages exist for every application claim | Build application (Tranche 2 scope) | Docs hub + docs.leontief.tech had no pages 10–12 | Hub pages 10 (Telegram), 11 (Autopilot — Tranche 2 scope), 12 (Agent Treasury Example) added and indexed | **Closed** — this pass |
| 4 | Threat model covers delegated signing surface (signer compromise, bot impersonation, deep-link tampering, bot-token compromise) | Build application (Autopilot scope) | Hub threat table + `docs-portal/docs/security.mdx` lacked all four rows; runbook lacked pause/revoke, token-rotation, kill-switch procedures | Four rows appended with mitigations; ops runbook + secrets matrix extended | **Closed** — this pass |
| 5 | Domain: `leontief.tech` everywhere | Site, app, docs live on .tech | `docs-portal/README.md` referenced `leontief.finance` | Replaced; CI grep added (zero occurrences allowed) | **Closed** — this pass |
| 6 | Tranche/budget source of truth = `leontief-build-application.md` | Build application (declared) | File **not committed to the repo** (checked every branch); `leontief-business-plan.md` still reads as tranche truth | Banner added to business plan pointing at the application; **file must be committed by the team** — docs cite it by name and cannot deep-link until it lands | **Open — blocked on team** (commit the application file) |
| 7 | RWA market size on Stellar: "roughly $2 billion" | Litepaper v1.1 (abstract, §8) | Litepaper HTML v1.0, `docs-portal/docs/overview.mdx`, business plan say "$3B+" | Aligned to litepaper v1.1 ($2B, dated "early–mid 2026") — the conservative direction; **team to re-verify the current rwa.xyz figure** and bump both litepaper + docs together if it has grown | **Closed** (docs aligned) — figure re-check noted |
| 8 | Repo URL: `github.com/monalika-walia/leontief` | Build application | Mixed-case `monalika-walia/leontief` in sdk README, site.ts, docusaurus config, overview.mdx, docs-site overview | Standardized lowercase everywhere (GitHub is case-insensitive; links unchanged in behavior) | **Closed** — this pass |
| 9 | Unified docs hub published at docs.leontief.tech | Application ("unified-docs field") | `DECISIONS.md` #6 says the unified source is mdBook on GitHub Pages; Docusaurus at docs.leontief.tech is what the site nav links | Decision recorded: docs.leontief.tech (Docusaurus) is the public hub; mdBook remains the internal engineering book; both build in CI | **Closed** — decision logged |
| 10 | `leontief-litepaper.md` exists as markdown source (referenced by the docs hub) | Docs hub header | File was absent from the repo (only the rendered HTML existed) | Committed verbatim as v1.1 this pass | **Closed** — this pass |
| 11 | A7 (`leontief-agent-demo-spec.md`), A8 (`leontief-telegram-autopilot-prompt.md`), multi-asset design (`leontief-multiasset-design.md`) named as sources | Truth-pass instructions | None of the three are committed on any branch | Hub pages 10–12 built from the application's stated policy facts (HF floor 1.6, caps, expiry ≤30d, revoke, Path A/B); **specs to be committed by the team** so pages can cite them | **Open — blocked on team** (commit the three files) |
| 12 | Metrics are honest: every figure labeled testnet, demo-asset named, dated; seeded activity never presented as organic AUM | Application + litepaper §9 ("team-seeded soak") | /performance figures previously appeared without methodology; docs cards had no counting rules | Hub page 13 "Traction & Metrics Methodology" added (counting rules, utility-ratio definition, labeling policy); litepaper §9 carries the honest framing | **Closed** — this pass |

## Resolution log

- **2026-08 (this pass):** rows 1–5, 7–10, 12 closed by the truth pass (branch `docs/truth-pass`).
- Rows **6** and **11** stay open until `leontief-build-application.md`,
  `leontief-agent-demo-spec.md`, `leontief-telegram-autopilot-prompt.md`, and
  `leontief-multiasset-design.md` are committed. Every page that depends on them cites them by
  name with a "source pending commit" note, so nothing published exceeds what those documents claim.
