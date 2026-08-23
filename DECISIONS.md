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

## #7 · 2026-08-02 · monalika walia · A9 slate ships 8 posts; posts 9 and 10 are held

- **Decision:** the A9 editorial slate lists ten posts, two of them conditional. Both are
  **held**, and the blog launches with the eight core posts. `erc-4626-on-soroban` was
  gated on the contracts being open-sourced; `agent-treasuries` was gated on "the A8
  ship-state matrix", which does not exist in the repo — and the agent-treasury work it
  would describe is still on a feature branch, not merged. Publishing a tutorial for code
  whose public status we cannot point at, or a post about a capability that has not
  shipped, would breach the A9 Phase-4 honesty rails in the first week of the blog.
  Revisit each when its gate is actually met: for post 9, a public contracts repo we can
  link; for post 10, a written ship-state matrix that records the feature as shipped.
- **Alternatives:** author both now with `draft: true` (costs the writing up front and
  risks the content drifting from what eventually ships — and a draft that sits for a
  quarter gets published without a re-check); ship post 9 immediately on the grounds that
  the repo is already public (defensible, but the tutorial should be written against the
  code as an outside reader finds it, which is a different piece of work).
- **Spec sections affected:** none.
- **Test impact:** none — `scripts/seo-check.mjs` only inspects posts that exist, and
  `draft: true` posts are excluded from the build, sitemap, and feed by construction.
- *AI-assisted session; entry reviewed by the human author of record.*

## #8 · 2026-08-02 · monalika walia · Blog lives at `leontief.tech/blog`, built by Astro inside `landing/`

- **Decision:** the blog is a path on the root domain (`leontief.tech/blog/<slug>`), never a
  subdomain — authority consolidates on one host. `landing/` becomes an Astro project: the A8-L
  landing, litepaper, and performance page move to `landing/public/` and ship **byte-identical**
  (Astro copies `public/` verbatim), while Astro owns `/blog`, `sitemap.xml`, `/blog/rss.xml`, and
  the generated OG cards. Vercel's Root Directory stays `landing/`; `landing/vercel.json` gains
  `buildCommand: npm run build` + `outputDirectory: dist`. Slugs are lowercase, hyphenated, and
  carry no date. Frontmatter is fixed by `landing/src/content.config.ts`
  (`title, description, slug, pubDate, updatedDate, author, tags[], cluster, draft`, plus
  `oneLine`, `faq`, `siblings`).
- **Alternatives:** (1) a second Vercel project proxied in via `rewrites` — keeps the landing
  deploy untouched, but puts an edge proxy hop on every post's critical path against a
  LCP < 1.5 s budget, and splits `sitemap.xml` across two deployments; (2) a new `site/` project
  owning the root — cleanest layout, but requires changing the Vercel Root Directory by hand and
  relies on "include files outside the root directory" being enabled, which cannot be verified
  from the repo. Keeping everything inside `landing/` needs no dashboard change at all.
- **Spec sections affected:** none (protocol untouched). docs-hub §09 (UI/UX) gains the blog.
- **Test impact:** new `Blog & SEO` workflow — `npm run build` + `scripts/seo-check.mjs` +
  `scripts/lighthouse-check.mjs`. Nothing in the Rust gate changes.
- *AI-assisted session; entry reviewed by the human author of record.*

## #9 · 2026-08-02 · monalika walia · Hand-rolled `sitemap.xml`; docs and app are separate crawl properties

- **Decision:** `sitemap.xml` is an Astro endpoint (`src/pages/sitemap.xml.ts`), not
  `@astrojs/sitemap`. The integration emits `sitemap-index.xml` + `sitemap-0.xml` and only knows
  about routes *it* built, so it can neither serve the required `/sitemap.xml` filename nor carry
  `lastmod` for the three static landing pages. The endpoint emits one `<urlset>` with `lastmod`
  driven by each post's `updatedDate` (falling back to `pubDate`), which is exactly the A9 Phase 6.5
  acceptance test. It lists **leontief.tech URLs only**: a sitemap may not carry URLs for another
  host without cross-submission, so `docs.leontief.tech` (its own Docusaurus-generated sitemap) and
  `app.leontief.tech` are verified in Search Console as separate properties. `docs/SEO.md` tracks
  the manual verification steps and their dates.
- **Alternatives:** `@astrojs/sitemap` with `customPages` (wrong filename, no per-URL `lastmod`);
  listing docs URLs in the root sitemap (Google rejects them as "URL not allowed").
- **Spec sections affected:** none.
- **Test impact:** `scripts/seo-check.mjs` asserts the sitemap is single-host, lists every post, and
  that each `<lastmod>` equals that post's JSON-LD `dateModified`.
- *AI-assisted session; entry reviewed by the human author of record.*

## #10 · 2026-08-02 · monalika walia · No analytics on the blog at launch

- **Decision:** the blog ships **no analytics**. The A9 brief allows "Plausible or none"; none is
  chosen because zero client JS is a hard budget for these pages and a measurement script is the
  only thing that would break it. Search Console and Bing Webmaster Tools already provide query,
  impression, and click data for the surface that matters, at no cost to the page. If audience data
  is later needed, Plausible is the pre-approved option and this entry gets a follow-up; no ad,
  attribution, or session-replay script is ever acceptable. Because nothing is collected, no cookie
  banner is needed by construction.
- **Alternatives:** Plausible from day one (~1 KB, privacy-first, but still a request and a script
  on a page whose entire performance argument is that it has neither).
- **Spec sections affected:** none.
- **Test impact:** `scripts/seo-check.mjs` fails the build on any non-JSON-LD `<script>` in a blog
  page, which is what keeps this decision from eroding.
- *AI-assisted session; entry reviewed by the human author of record.*

## #11 · 2026-08-02 · monalika walia · Root shell title is the A9 line, not the A8-L line

- **Decision:** `leontief.tech` now serves `<title>Leontief — Put tokenized treasuries to work on
  Stellar</title>`, replacing A8-L's "Leontief — Wake your assets". The A9 brief specifies this
  string, and it carries the terms the pillar post is written for ("tokenized treasuries",
  "Stellar") where the previous line carried none. The hero copy, canvas, and every visible word on
  the page are untouched — this is the crawl surface, not the design. `landing.html` (a byte
  mirror of `index.html`, kept because `docs/DEPLOY.md` and `landing/README.md` reference it) now
  canonicalizes to `https://leontief.tech/` so the two paths stop competing.
- **Alternatives:** keeping the A8-L title (loses both target terms); deleting `landing.html`
  (breaks documented URLs for no gain once the canonical is in place).
- **Spec sections affected:** none.
- **Test impact:** `scripts/seo-check.mjs` asserts the canonical of every static page, including the
  mirror.
- *AI-assisted session; entry reviewed by the human author of record.*

## #12 · 2026-08-13 · monalika walia · Docs truth pass: hub = Docusaurus at docs.leontief.tech; org line = Lemma Labs; Autopilot Path A

- **Decision (1):** the public unified docs hub is the **Docusaurus portal at docs.leontief.tech**
  (already live and linked from the site's DOCS nav). Supersedes #6's mdBook-as-unified-source:
  mdBook (`docs-site/`, GH Pages) remains the internal engineering book; both build in CI.
- **Decision (2):** org line standardized verbatim everywhere: "Leontief is a Lemma Labs protocol
  (lemmalabs.space) — a Stellar-focused studio; Estonian OÜ registration in progress." Replaces all
  29Projects Lab framing on public pages (this log keeps its history unedited).
- **Decision (3):** Autopilot delegated signing is **Path A — Protocol 27 delegated signing
  (CAP-0071-01)**, constraint set enforced by the ledger; Path B (session-key policy contract) is
  the documented fallback if Path A tooling isn't production-ready in the Tranche 2 window.
- **Why:** the Build application is now the single source of truth for tranches/budget/claims; the
  truth pass (docs/DRIFT.md) binds every claim to a current page and nothing more.
- **Spec sections affected:** none (spec frozen; status ledger added at `docs/STATUS.md`).
- **Test impact:** CI greps added — zero occurrences of the retired domain, zero of the old studio-incubation phrase,
  zero unfilled insert-placeholders on published pages (patterns live in .github/workflows/docs-hub.yml).
- *AI-assisted session; entry reviewed by the human author of record.*
