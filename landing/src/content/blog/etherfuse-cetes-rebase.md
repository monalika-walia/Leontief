---
title: "CETES On-Chain: How Etherfuse Stablebonds and the Weekly Rebase Work"
description: "Mexican treasury certificates as a token, and the accounting problem they create: when a balance can change on its own, most DeFi arithmetic quietly breaks."
slug: etherfuse-cetes-rebase
pubDate: 2026-08-17
author: monalika
cluster: Etherfuse stablebonds
tags:
  - Etherfuse
  - CETES
  - stablebonds
  - rebase
  - Stellar
oneLine: "A stablebond can pay you by growing your balance rather than its price — and a balance that changes on its own is the single assumption most vault arithmetic gets wrong."
siblings:
  - borrow-against-usdy-stellar
  - idle-rwa-stellar
faq:
  - q: "What are CETES?"
    a: "Certificados de la Tesorería de la Federación — short-dated debt issued by the Mexican federal government and denominated in Mexican pesos. They are the local equivalent of a Treasury bill, and they are the underlying for Etherfuse's CETES stablebond."
  - q: "Who can buy Etherfuse stablebonds?"
    a: "Not everyone. The Stellar Development Foundation's own announcement states that the stablebonds issued by Etherfuse are only available for certain non-US persons in select jurisdictions, and that they are not for sale in the United States or to US persons. Check Etherfuse's current terms before assuming eligibility."
  - q: "Does a rebase make me richer?"
    a: "No. A rebase changes how a claim is expressed, not how large it is. If every holder's balance grows by the same proportion at the same moment, everyone's share of the pool is exactly what it was a second earlier. Yield comes from the underlying bond, not from the mechanism that reports it."
  - q: "Why does a rebasing balance break lending protocols?"
    a: "Because most of them record the number you deposited and treat it as authoritative afterwards. When the token itself can change that number, the recorded figure and the real balance drift apart, and everything computed from the recorded figure — collateral value, health factor, what a withdrawal owes you — drifts with it."
---

Mexico's federal government has issued Certificados de la Tesorería de la Federación
— CETES — for decades. They are short-dated peso debt: the local equivalent of a
T-bill, bought at a discount and redeemed at face value, with the difference standing
in for interest.

[Etherfuse](https://etherfuse.com/products/stablebonds) tokenizes them. Its
description is plain enough to quote: a stablebond is "a tokenized government bond, a
digital representation of sovereign debt issued by national treasuries," and the
tokens "can be redeemed for fiat at NAV any business day. No lock-ups, no gates."
The Stellar Development Foundation's
[announcement](https://stellar.org/blog/foundation-news/global-bonds-local-impact-stablebonds-on-stellar)
describes the same collection as "government-issued treasury bonds from countries
like the United States and Mexico," with returns distributed to holders "as the
underlying treasury bonds earn interest and/or mature."

It also carries the sentence that matters most: "The Stablebonds issued by Etherfuse
are only available for certain non-U.S. persons in select jurisdictions. They are not
for sale in the United States or to U.S. persons."

## Why anyone wants peso paper on a ledger

The rate environment is the whole argument. On 2 August 2026, Etherfuse's own product
page listed an illustrative CETES yield of about 5.5%, against roughly 3.2% for its US
Treasury bond and around 1.9% for its euro bond. Those are the issuer's published
figures on that date, not a projection and not an offer, and they move with each
government's auctions.

For a saver in Mexico this is not exotic — it is the default savings instrument,
reachable through Cetesdirecto with a bank account. What tokenization changes is who
else can reach it, and in what denomination. On Stellar the fees are small enough that
buying a fractional position is not absurd, which is the actual unlock: sovereign debt
in sizes that make sense for individuals.

It also puts a second kind of paper next to the dollar instruments that dominate the
category. Most of [the tokenized real-world assets sitting idle on Stellar](/blog/idle-rwa-stellar)
are claims on US Treasuries. A peso bond is a different credit, a different curve, and
a different currency — which makes it more interesting as collateral and considerably
more dangerous as a position.

## The rebase, and an honest caveat about it

Here is where we have to be careful, because this is the part everyone repeats and
nobody sources.

Etherfuse's public documentation says stablebonds "accrue yield automatically" and are
redeemable at NAV on any business day. It describes assets, ramps, and identifiers —
its Stellar guide tells integrators to "always read identifiers from `GET /ramp/assets`
— never hardcode the issuer" — but as of 2 August 2026 it does **not** publish the
schedule on which a balance changes. Secondary write-ups describe a weekly cadence.
We have not been able to confirm that against a primary source, so we are not going to
assert it as a fact about the product.

What we can do is be exact about the mechanism, because that is what a builder needs.

A **rebasing** token delivers yield by changing balances. You hold 1,000 units; a
rebase runs; you now hold 1,004 units, and so does everyone else in proportion. No
transfer occurred. No event you were watching for fired. The number simply changed.

A **price-accruing** token delivers the same economics by leaving the count alone and
letting each unit be worth more. USDY works this way — its yield is
[reflected through an increasing redemption price](/blog/borrow-against-usdy-stellar).

Both pay the same. Only one of them can change your balance while you are not looking,
and that difference is the subject of the rest of this post.

## What a rebase breaks

Almost every naive integration makes the same assumption without noticing: **the number
I recorded at deposit is still true.**

Consider a vault that accepts deposits and issues shares. The obvious implementation
reads the amount from the caller's request, adds it to a running total, and mints
shares against that total. Now put a rebasing asset through it.

- **Recorded totals drift from real holdings.** The vault believes it holds the sum of
  what depositors said they sent. The token has since adjusted every balance. The two
  numbers are now different, and every share price computed from the recorded one is
  wrong.
- **The drift is not neutral.** It accumulates in whichever direction the rebase runs,
  and it is claimed by whoever exits at the right moment — usually not the person who
  earned it.
- **Deposit timing becomes a game.** If a rebase is scheduled and the vault prices on
  recorded totals, then depositing immediately before and withdrawing immediately after
  is a strategy. Nothing about it requires sophistication, only a calendar.
- **Collateral value goes stale silently.** A lending pool holding a stale figure
  under-collateralises or over-collateralises positions with no error, no revert, and
  nothing in a log to notice.

The failure mode is quiet. That is what makes it dangerous — there is no moment where
something obviously breaks, only a slow divergence between the books and the balances.

## How normalization handles it

The fix is not clever, and that is the point. It is two disciplines applied everywhere,
with no exceptions.

**Measure, do not trust.** Every transfer into the vault is measured by balance
difference: read the vault's balance, perform the transfer, read it again, and treat
the difference as what was received. The caller's claimed amount is an input to a
transaction, not a fact about the world. A rebase that lands mid-transaction is
captured by construction, because the second read includes it.

**Price by ratio, never by a stored total.** Shares are minted against the vault's
*current* holdings valued at the current net asset value, not against a running tally.
In the prototype the mint leg is

```
shares = received_value × (total_shares + VIRT) / (vault_value + VIRT)   ⌊floor⌋
```

with `VIRT = 10³` as a virtual offset on both the mint and redeem legs, and an internal
price scale of `SCALE = 10¹²`. Rounding is directional and consistent: floor toward the
user on what they receive, ceiling toward the protocol on what they owe, so no sequence
of operations can round value out of the pool.

The virtual offset is there for a different attack — a first depositor donating assets
to inflate the share price against the second — but it does double duty here. Both
problems are the same problem in different clothes: someone changing the vault's real
holdings without going through a mint. Balance-difference measurement and a ratio-based
share price close both at once.

The consequence worth stating plainly: a rebasing asset and a price-accruing asset need
**no separate code paths**. Both raise the vault's holdings. The share price rises
either way. That is the whole trick: the mechanic a token uses to report yield is an
implementation detail of the token, and the vault above it never needs to know which
one it is holding.

## Try it on testnet

The Leontief vault runs this accounting today on Stellar testnet, against a restricted
stand-in asset rather than a live issuer's bond. You can deposit, watch the share price
move as the net asset value ticks, pledge the shares, and redeem — in
[the app](https://app.leontief.tech), with the arithmetic written out in
[the vault docs](https://docs.leontief.tech/protocol/vault).

## The risks, plainly

**This is a testnet prototype.** There is no mainnet deployment, no Etherfuse
integration in production, and no token. Nothing here is investment advice or an offer.

**Currency risk is the headline risk, and it is not small.** CETES pay in pesos. A
holder who thinks in dollars is taking a peso position whether or not they meant to,
and the exchange rate can move further in a week than the coupon pays in a year. No
amount of good on-chain accounting touches this.

**Eligibility is real.** Etherfuse's stablebonds are not for sale in the United States
or to US persons, and are available only to certain non-US persons in select
jurisdictions.

**Issuer and custody risk.** A stablebond is a claim on a structure holding sovereign
debt. You are exposed to the sovereign, to the custodian, and to the issuer's ability
to honour redemption at NAV — three things, not one.

**Oracle behaviour under stress.** Pricing a peso-denominated bond needs both a bond
valuation and an exchange rate. Our adapter is fail-closed: if either input is stale or
jumps beyond its bound, pricing halts rather than guessing, and new borrows stop while
withdrawals stay open. That is the correct behaviour and it is still an outage.

**We have not integrated Etherfuse.** Everything above about their product comes from
their published material, linked at each claim. Before building against it, confirm the
current mechanics — the rebase cadence in particular — with the issuer directly.
