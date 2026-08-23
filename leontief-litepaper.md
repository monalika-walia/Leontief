# Leontief
**The layer that wakes up real-world assets on Stellar**

*Litepaper · v1.1 · August 2026 · a Lemma Labs protocol*

> Rendered edition: [leontief.tech/litepaper](https://leontief.tech/litepaper). This file is the
> markdown source of truth for thesis claims; the docs hub must not claim more than this document
> and the Build application do. Updated August 2026.

## Abstract

Roughly $2 billion of tokenized real-world assets — US and Mexican treasuries, money-market funds,
private credit — now live on Stellar, growing about 3× year over year. Almost all of it is idle.
Holders earn the base coupon and nothing else: the assets cannot be borrowed against, pooled, or
compounded, because the rules that make them safe in the real world make them incompatible with
DeFi on-chain.

Leontief is an adapter layer, not another lending protocol. It wraps restricted RWAs into
normalized, freely-composable share tokens that keep accruing the underlying's native yield, then
routes those shares into existing venues — Blend for credit, Aquarius for liquidity. One asset, two
jobs, at the same time: still earning, now working.

The protocol is named for Wassily Leontief, whose input–output model describes how one sector's
output becomes another sector's input. That is precisely what this protocol does: real-world output
(treasury yield) becomes on-chain input (productive collateral).

## 1 · The idle-asset problem

Tokenization succeeded on Stellar. Utility didn't — yet.

Franklin Templeton, Centrifuge, Etherfuse, and (soon) State Street issue real-world assets natively
on Stellar. The supply side of RWA finance is arriving faster here than almost anywhere. But a
holder of a tokenized T-bill on Stellar today can do essentially one thing with it: hold it.

Compare that to USDC. A stablecoin holder can lend it, borrow against it, LP it, and stack
strategies on top — capital efficiency measured in multiples. A tokenized treasury holder gets the
coupon, full stop. The higher-quality asset is the less productive one on-chain. That inversion is
the market gap.

## 2 · Why RWAs break DeFi

This isn't a demand problem. RWA tokens are structurally hostile to naive composability, for three
reasons:

**Transfer restrictions.** Regulated assets enforce who may hold them — via SEP-8 authorization
today, and SEP-57 (T-REX-style permissioned tokens) next. Send one to an unapproved address and the
transfer reverts. A standard AMM pool or lending vault is exactly such an unapproved address.

**NAV pricing.** These assets settle against net asset value published from the real world, not
against a spot order book. Spot-price oracles cannot price them; naive integrations either can't
value collateral at all or misprice it — a direct solvency risk.

**Incompatible yield mechanics.** Some assets rebase, some accumulate value into the token price,
some distribute. Wrap them carelessly and value leaks — yield accrues to the wrong party or is lost
outright.

The most severe consequence sits downstream: **liquidation**. Even if a venue accepted a restricted
RWA as collateral, it could not legally hand that collateral to an arbitrary liquidation bidder.
Without a lawful unwind path, restricted RWAs cannot be credit collateral at all. No protocol on
Stellar solves this generally. Leontief is built around solving it.

## 3 · The Leontief thesis

Three design principles define the protocol:

**Wrap, don't rebuild.** Leontief is deliberately not a lender or an exchange. Lending stays with
Blend; liquidity stays with Aquarius. Leontief does the one thing they can't — make restricted
assets behave — and feeds them. This keeps the protocol thin, auditable, and complementary to the
ecosystem rather than competitive with it.

**Compliance is the product, not the obstacle.** The protocol never bypasses a transfer
restriction; it encodes and enforces them. That is what makes institutional-grade assets (and
eventually SEP-57 permissioned funds) addressable at all.

**Yield never stops.** A deposited asset keeps earning its native yield even while its share is
pledged as collateral or deployed as liquidity. Passthrough-while-pledged is a core mechanic, not a
feature.

## 4 · Architecture

Six components, one job each:

**Vault Factory.** One isolated vault per asset. The vault holds the restricted underlying,
maintains its trustline, and manages SEP-8 authorization on the holder's behalf. Isolation means an
issue with one asset (a freeze, a clawback) is contained to its own vault.

**Share Token.** Depositing into a vault mints a normalized, freely-transferable share (ldTRSY,
ldCETE, ldUSTR, …). The share is the composable object: it carries the deposit's value and yield
with none of its transfer restrictions.

**Yield Accounting.** All accrual styles — rebasing, accumulating, distributing — are normalized
into a single share-price mechanic:

```
share price = total underlying value (NAV × units + accrued, undistributed yield) ÷ total shares
```

The share price only rises as yield accrues. No rebasing on the share side, ever — which is what
keeps shares compatible with vanilla DeFi integrations.

**Oracle Adapter.** Normalizes NAV feeds from Reflector, RedStone, and Chainlink into one
interface, with staleness windows, deviation bounds, and update-cadence handling tuned to NAV
(which updates on real-world schedules, not per-block).

**Risk & Isolation.** Per-asset supply caps sized to real redemption liquidity, per-issuer
isolation, and circuit breakers that pause a single vault on anomalous events (issuer freeze,
oracle deviation) without touching the rest of the protocol.

**Composability Router + Permissioned Liquidation.** The router is how shares reach Blend
(collateral) and Aquarius (LP). The liquidation path — the protocol's most novel component — gets
its own section.

Data flow, end to end: deposit RWA → authorization check → vault mints shares at current share
price → oracle prices NAV continuously → shares deployed to Blend / Aquarius while yield accrues to
share price → withdrawal burns shares, returns underlying plus accrued yield. Unwinds under
distress route through the permissioned liquidation path.

## 5 · Permissioned liquidation

The unsolved problem in RWA credit: you cannot sell transfer-restricted collateral to an arbitrary
bidder. Leontief resolves it with a three-tier waterfall, each tier lawful by construction:

**Tier 1 — Whitelisted liquidators.** A set of KYC'd, issuer-authorized addresses eligible to bid
on seized collateral. For them, liquidation looks conventional; the whitelist is what makes it
legal.

**Tier 2 — Redemption unwind.** If no whitelisted bidder acts, the protocol redeems the underlying
with the issuer at NAV and repays the debt from proceeds. This converts "sell the collateral" into
"redeem the collateral," which restricted assets are always allowed to do.

**Tier 3 — Issuer-mediated backstop.** For deeply permissioned assets, a pre-agreed issuer
procedure transfers the position to an approved holder of last resort.

Solvency is protected upstream of all three tiers: conservative loan-to-value ratios, supply caps
sized to each asset's real redemption liquidity (including gates and settlement windows), and
NAV-deviation circuit breakers.

The MVP launches on freely-transferable RWAs, where Tier 1 reduces to standard liquidation — so the
protocol ships without waiting on issuer agreements, while the permissioned tiers harden in
parallel.

## 6 · The share token in practice

A concrete walk-through, with illustrative numbers:

1. You hold 100,000 USTRY (tokenized US T-bills) at a NAV of 1.0209. You deposit into the USTRY
   vault and receive ldUSTR shares worth $102,090.
2. Your shares keep appreciating as the T-bill coupon accrues — roughly the asset's ~4.8% APY,
   reflected in a rising share price.
3. You post the shares as collateral on Blend and borrow, say, 60,000 USDC against them (well
   inside the asset's maximum LTV). A health factor tracks your position against the NAV feed.
4. You now have working stablecoin liquidity **and** your treasury yield — simultaneously.
5. Repay, withdraw, burn the shares, and receive your USTRY back plus everything it earned while
   pledged.

If NAV moves against the position or debt grows past the threshold, the permissioned liquidation
waterfall unwinds it — inside the asset's rules, always.

## 7 · Why Stellar

**The collateral is already here.** RWA supply on Stellar is unusually dense relative to how thin
the utility layer is. On Ethereum, the utility layer is saturated; here, the assets arrived first.
That supply/demand inversion is the entire opportunity.

**Restrictions are native primitives.** SEP-8 authorization and trustlines enforce transfer rules
at the ledger; SEP-57 brings T-REX-style permissioned tokens as a Stellar-native standard. On EVM
chains these guarantees must be re-implemented per-contract. A compliance-aware wrapper is simply
cleaner to build here.

**The oracle blocker just cleared.** Through early 2026, NAV pricing was the binding constraint.
RedStone launched on Stellar mainnet with a BENJI feed, Chainlink joined via the Scale program, and
Reflector is live. Reliable NAV is now an input, not a research problem.

**Fees make passthrough viable.** Continuous share-price accrual and small-balance operations are
only economical on a network with negligible fees and fast finality. Micro-yield accounting that
would be absurd on Ethereum L1 is routine on Stellar.

## 8 · Business model

Leontief is tokenless by design. Revenue is recurring and tied to real-world yield rather than
emissions:

- **Management fee** — basis points on wrapped AUM held in vaults.
- **Utility uplift share** — a small performance cut of the additional yield users capture by
  putting shares to work (the value Leontief creates, priced on the value it creates).
- **B2B integration layer** — over time, issuers (whose AUM grows when their assets become
  productive) and protocols (who want RWA support without building compliance plumbing) integrate
  Leontief as infrastructure.

Even a modest share of a $2B-and-compounding idle base is meaningful, durable, non-inflationary
revenue. No token is required for the protocol to function or to earn.

## 9 · Roadmap

| Phase | Scope | Status |
|---|---|---|
| 0 — Thesis | Architecture, mechanism design, full frontend (landing + app) | **Complete** |
| 1 — Testnet MVP | Vault factory, share token, yield accounting, NAV oracle adapter; comprehensive test suite | **Live on testnet** — core deployed on a SEP-8 demo asset; $469k wrapped at live Reflector NAV across 49 testnet wallets (Aug 2026) |
| 2 — First utility | USDC borrowing against shares via Blend with yield-passthrough proven; permissioned-liquidation Tier 1 live | **In progress · Tranche 1–2** |
| 3 — Mainnet, capped | Security review/audit; conservative supply caps; 2–3 assets (USDY, CETES/USTRY); first issuer partnership | Tranche 3 |
| 4 — Growth | TVL and active-supplier targets; management fee accruing; Aquarius LP path | Months 3–5 |
| 5 — Permissioned era | First SEP-57 / T-REX asset live (Tiers 2–3 in production); first external protocol integrating Leontief shares | Months 5–8 |
| 6 — Multi-asset era | Tokenized commodities, then equities/ETFs, via class-based risk templates + a peg-integrity module (dual-source min-pricing, depeg breakers, market-calendar oracles) — design published; activates as issuers land on Stellar | Post-mainnet · supply-triggered |

## 10 · Risk factors

**Smart-contract risk.** Mitigated with an isolated-vault architecture, extensive testing, external
review before mainnet, and conservative caps at launch.

**Oracle & NAV risk.** Multi-provider adapter, staleness windows, deviation circuit breakers; caps
sized so that worst-case mispricing is absorbable.

**Issuer & redemption risk.** Redemption gates or settlement delays could slow Tier-2 unwinds; caps
are sized to each asset's actual redemption liquidity, not its market cap.

**Regulatory surface.** The protocol's core premise is respecting transfer restrictions, never
bypassing them; the compliance-forward design is itself the mitigation.

**Cold-start liquidity.** Addressed through issuer distribution partnerships (issuers gain AUM when
their assets become productive) and ecosystem incentive programs post-launch.

## Appendix A · Initial asset set (illustrative)

| Asset | Issuer | Type | Yield mechanic | Native APY* | Share | Status |
|---|---|---|---|---|---|---|
| USDY | Ondo | US treasuries + deposits (Reg S note) | Price-accrual | ~4.7% | ldUSDY | Launch set (verified on Stellar) |
| CETES | Etherfuse | Mexican treasury bills | Weekly rebase | ~8–10% | ldCETE | Launch set (verified on Stellar) |
| USTRY | Etherfuse | US treasury notes | Weekly rebase | ~5% | ldUSTR | Launch set (verified on Stellar) |
| Spiko funds | Spiko | EU/US T-bill money-market | Accumulating | ~3–5% | ldSPKO | Expansion (verification in progress) |
| deJTRSY | Centrifuge | Short-term US treasuries | Accumulating | ~4.9% | ldTRSY | Expansion (Stellar issuance unverified) |
| BENJI | Franklin Templeton | US gov money-market fund | Daily accrual, monthly dist. | ~4.7% | ldBENJI | Permissioned era |
| SWEEP | State Street | Private liquidity fund | — | — | ldSWEEP | Permissioned era |

\*Yields are illustrative as of writing and float with underlying rates.

## Appendix B · Plain-language glossary

**RWA** — a real-world asset (like a treasury bill) represented as a token on-chain. **NAV** — net
asset value; the asset's real-world price, published by its issuer or fund administrator. **SEP-8 /
SEP-57** — Stellar standards for regulated and permissioned tokens; the "rules" an asset carries
about who may hold it. **Share token** — the freely-movable receipt Leontief mints against a
deposit; it holds the deposit's value and yield without its restrictions. **LTV** — loan-to-value;
how much you may borrow against collateral. **Health factor** — a live measure of how safe a
borrowing position is; below 1, it can be liquidated.

---

*This litepaper describes protocol design and intent; parameters, assets, and timelines may change
through development and review. Market figures reflect ecosystem data as of early–mid 2026. Nothing
herein is financial advice. Leontief is a Lemma Labs protocol (lemmalabs.space) — a Stellar-focused
studio; Estonian OÜ registration in progress.*
