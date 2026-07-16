# Leontief — Business Plan v1.0
**A 29Projects Lab protocol · July 2026 · tokenless by design**

## 1 · Executive summary

Leontief converts Stellar's largest and fastest-growing pool of value — $3B+ in tokenized real-world assets — from idle holdings into productive collateral, taking a small recurring fee on the value it activates. It is infrastructure, not a destination app: revenue scales with wrapped AUM and with the venues (Blend, Aquarius) and issuers (Ondo, Etherfuse, later Franklin Templeton–class permissioned funds) that build on it. No token; revenue is real-yield-linked and non-inflationary.

## 2 · Market

- **Supply:** $3B+ RWAs on Stellar (3× YoY), concentrated in exactly the instruments people borrow against elsewhere: T-bills, MMFs, short credit.
- **Demand proof:** on Ethereum, ~$9B of tokenized treasuries became active collateral once venues accepted them; issuer AUM measurably follows utility (BUIDL↑ after exchange-margin acceptance; OUSG↑ after Aave listing). Same assets, same holders, no equivalent rail on Stellar.
- **Structural tailwind:** SDF targets ~$1B of further asset growth in 2026; DTCC's Stellar tokenization work lands 2027. Supply keeps arriving on a utility layer that doesn't exist yet.
- **Serviceable near-term:** freely-transferable assets on Stellar (USDY ~$529M + Etherfuse Stablebonds + Spiko pending verification). Wrapping even 2–5% of the near-term serviceable pool = $15–40M AUM inside year one.

## 3 · Product & moat

The adapter layer: per-asset vaults minting composable ld-shares; fail-closed NAV oracle adapter; dual-accrual normalization (rebase + price-accrual in one accounting formula); **permissioned liquidation** — the mechanism nobody on Stellar has, and the unlock for restricted (BENJI/SEP-57-class) assets, which are the majority of the market by value.

**Moat, honestly assessed:** (1) the permissioned-liquidation design + issuer relationships it requires; (2) integration gravity — once Blend pools, Aquarius LPs, and third-party protocols consume ld-shares, switching is a coordinated migration; (3) compliance posture as product: the SEP-57 era rewards whoever built *with* restrictions from day one. What is *not* a moat: the basic vault wrapper — speed and integrations must convert the head start.

## 4 · Business model & revenue math

Fee switch ships **OFF** at mainnet (cleaner audit, cleaner launch narrative). Activation post-traction, pre-announced:

| Stream | Mechanism | Rate (target) |
|---|---|---|
| Management fee | bps on wrapped AUM, accrued in share-price | 15–25 bps/yr |
| Utility uplift share | % of *incremental* yield users earn by deploying shares (borrow spread capture, LP fees routed) | 5–10% of uplift |
| B2B integration (later) | issuer white-label wrapping; protocol integration support | negotiated |

**Worked math (management fee @ 20 bps):** $10M AUM → $20K/yr · $50M → $100K/yr · $150M → $300K/yr. Uplift share at scale is comparable or larger (e.g., $50M deployed at +3% incremental yield × 7.5% share ≈ $112K/yr). **Break-even** for a lean 3–4 person team (~$260–300K/yr fully loaded) sits around $60–90M AUM with both streams on — aggressive for year one, plausible in year two against a $3B+ and compounding base. Bridge funding to that point: SCF award, follow-on SCF (lifetime cap headroom to $150K), Stellar Liquidity Award for bootstrapping pool depth, and optional venture round only after organic traction (studio policy).

## 5 · Go-to-market

1. **Issuers as distribution** (weeks 1–8 post-mainnet): Etherfuse and Ondo gain AUM when their assets gain utility — co-announcements, docs co-marketing, their holder channels. The Ethereum causality data is the pitch deck.
2. **Venue co-launch:** a Blend pool accepting ldUSDY at launch day; Aquarius incentive alignment via the Stellar Liquidity Award (separate SCF supporting program — not our budget).
3. **Holder conversion:** waitlist + LOI pipeline built pre-SCF converts to first depositors; "your idle T-bills now borrow" campaign run by the studio (marketing costs are outside the SCF budget by rule and funded by 29Projects Lab).
4. **B2B wedge (months 3–9):** SDK-first outreach to Stellar protocols that want RWA collateral without compliance plumbing; success metric = 2+ external integrations in 90 days.
5. **Permissioned era (months 6–12):** SEP-57 pilot with one permissioned issuer — the step that opens the BENJI-class majority of the market.

## 6 · Competition

| Player | What they are | Overlap | Our answer |
|---|---|---|---|
| Blend / Script3 | Lending pools | Venue, not wrapper | We are their new collateral supply; co-launch partner |
| Templar | RWA lend/borrow vaults | Asset-by-asset credit | No general wrapper, no permissioned liquidation |
| Splyce | RWA yield products (own vaults, splyceUSDC) | Nearest neighbor | Destination vs plumbing: we're neutral infra feeding all venues incl. potentially theirs |
| Kinetic K2 | Lending infra (pipeline) | Venue | Same as Blend — future consumer of ld-shares |
| Do-nothing | Assets stay idle | Default | The $3B/$217M gap is the counterargument |

## 7 · KPIs

Wrapped AUM · unique suppliers · % of shares deployed (utility ratio — *the* metric) · borrow volume against ld-shares · external integrations · issuer partnerships · fee revenue run-rate (post-switch) · incident count (target: zero loss events, ever).

## 8 · Organization

- **Protocol team (submitter):** Monalika (protocol lead), Aditya (contracts/risk), Vyom (full-stack), part-time DevOps/QA. Dedicated solely to Leontief; each completes SCF KYC.
- **29Projects Lab:** incubating studio — advisory (Kunal), design system, GTM/marketing spend (outside SCF budget), entity/ops support. Entity for KYB: `[29Projects Lab HK entity / new SPV — decide pre-award; registration costs borne by studio, not the award]`.
- **Governance of funds:** award XLM held in a 2-of-3 team multisig; payroll and infra paid on a published monthly cadence; tranche reports include spend-vs-deliverable mapping.

## 9 · Risk register

| Risk | L | I | Mitigation |
|---|---|---|---|
| Smart-contract loss event | M | Critical | Frozen spec, property/fuzz tests, Audit Bank audit, capped launch ($500K/asset), pause drills, no fee complexity at launch |
| Oracle failure/manipulation | M | High | Fail-closed adapter, staleness+deviation breakers, multi-provider roadmap, caps sized to worst-case mispricing |
| Issuer action (freeze/gate/redemption delay) | M | High | Per-asset isolation, caps ≤ redemption liquidity, Tier-2 unwind design, launch on assets with open secondary transfer |
| Regulatory reclassification of wrapped shares | L–M | High | Compliance-forward design (restrictions enforced, never bypassed); ld-shares as receipts not new securities claims — counsel review pre-mainnet (studio-funded); geo-fencing capability in frontend |
| Cold-start liquidity | M | Medium | Issuer distribution, Liquidity Award, conservative targets set to beat |
| Competitor speed (Splyce et al.) | M | Medium | Ship the restricted-asset wedge first; integrations as switching cost |
| Key-person/team continuity | L | Medium | Three-person bus factor, documented spec + DECISIONS.md, studio bench |
| XLM award volatility | M | Medium | Convert operating runway per policy on receipt; tranche-paced exposure |

## 10 · Compliance posture (SCF Official Rules alignment)

No token, ever, is required or planned — nothing here promotes a specific token. No marketing of XLM yield or returns; all yield language refers to the underlying RWAs' real-world instruments. Not gambling, not data-storage abuse; contracts open-sourced per plan. Award funds used solely for forward development deliverables; marketing, legal, and audits are explicitly funded elsewhere (studio / Audit Bank). Team and entity are OFAC-clean and KYC/KYB-ready, including re-verification on any leadership or representative change.

## 11 · Twelve-month picture (post-award)

Mainnet with 2–3 assets and caps → integrations + Liquidity Award depth → fee switch on at demonstrated utility → SEP-57 pilot → follow-on SCF for the permissioned era → revenue-supported team, venture optionality retained but not required.
