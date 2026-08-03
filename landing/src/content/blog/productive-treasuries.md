---
title: "Still Earning, Now Working: The Case for Productive Treasuries"
description: "The safest assets on-chain are also the least useful ones. That is not an accident of engineering — it is a choice nobody has got round to unmaking."
slug: productive-treasuries
pubDate: 2026-08-24
author: monalika
cluster: Productive treasuries
tags:
  - tokenized treasuries
  - RWA
  - thesis
  - Stellar
oneLine: "One asset should be able to hold two jobs at once: earn what it was bought to earn, and stand behind a loan while it does."
siblings:
  - idle-rwa-stellar
  - borrow-against-usdy-stellar
---

There is a particular kind of waste that is invisible because it looks like prudence.

A treasury fund token sits in an account. It earns what short-dated government paper
earns. It settles in seconds, costs almost nothing to move, and carries the credit of
a sovereign. By every measure a saver cares about, it is doing its job.

And that is the entire problem. It is doing *its* job — one job, the same job, for
years, while every other asset on the same ledger is expected to do two or three.

## The safest assets on-chain are the least useful ones

Run the comparison honestly and it is uncomfortable.

A volatile crypto asset with no cash flow and no issuer can be supplied to a lending
market, borrowed against, paired in a pool, and used as margin, all before lunch. A
tokenized Treasury bill — an instrument with a coupon, a custodian, an auditor, and a
government behind it — can be held. That is the whole menu.

The asset with better credit has worse utility, and the gap is not small. On Stellar,
[three billion dollars of tokenized real-world assets sit against a couple of hundred
million dollars of DeFi](/blog/idle-rwa-stellar). The safe money is the idle money.

We have inverted something. Quality of collateral is supposed to buy you *more*
optionality, not less.

## The inversion has a cause, and it is a good one

It would be satisfying to blame inertia. It is not inertia.

The reason a treasury token cannot be used the way a volatile token can is that
somebody is responsible for it. There is an issuer with a regulator, an offering
document with eligibility conditions, and a set of holders who were checked before
they were allowed in. Those facts are what make the asset worth holding. They are also
what make it impossible to hand to a contract that will give it to whoever wins a race.

Every serious attempt to fix this runs into the same fork. You can weaken the rules
until the asset composes — at which point it is no longer the regulated instrument
anyone wanted — or you can accept the rules and build something that works *around*
them rather than through them.

The second path is narrower and much less fun. It is also the only one that ends
somewhere real.

## Two jobs, one asset

Here is the whole thesis, and it fits in a sentence: **the restricted thing should stay
still, and something unrestricted should move in its place.**

Put the regulated asset in one vault that the issuer has evaluated and approved, once.
Issue the holder an [`ld`-share](https://leontief.tech/litepaper#sec-b) in that vault. The share is not the security; it is a claim on
a pool of the security, and it can do everything an ordinary token can do — sit in a
pool, back a loan, be transferred to a counterparty who was never on anyone's list.

Meanwhile the underlying keeps earning, because nothing about a coupon depends on
whether the holder is currently using the position for something else. The vault's
share price rises. Yours rises with it, whether the share is idle in your wallet or
pledged against a stablecoin loan you took out three weeks ago.

Still earning. Now working.

That phrase is not a slogan we reverse-engineered; it is a description of an accounting
property. Yield accrues to the vault's holdings. Pledging a share moves the share, not
the holdings. The two facts are independent, which is why the position can hold two
jobs without either interfering with the other.

There is a second, quieter benefit that only shows up when you look at it from the
issuer's side. Under the ordinary arrangement, an issuer who wants their asset to be
useful has to evaluate every venue their holders might ever want to use — each lending
pool, each exchange, each counterparty — and re-evaluate whenever any of them changes.
That workload scales with the ecosystem and never ends. Under this one, the issuer
evaluates a single vault, once, with a known set of powers. It is a smaller ask, and
"smaller ask" is usually what stands between a good idea and a signature.

The mechanics of the loop — deposit, pledge, borrow, repay — are written out in
[how to borrow against tokenized treasuries](/blog/borrow-against-usdy-stellar).
They are less interesting than they sound, which is the point. Infrastructure that
works is boring to describe.

## What honesty requires us to say

A manifesto that only lists advantages is marketing. So, the other column.

**This is slower.** [Permissioned liquidation](/blog/permissioned-liquidation) trades
speed for lawfulness — a whitelist of approved liquidators, a redemption unwind behind
it, and a manual backstop behind that. There is no version of this that liquidates as
fast as a permissionless pool. Anyone promising otherwise has not read the offering
document.

**Restriction is paid for in borrowing capacity.** Fewer eligible liquidators means
worse liquidation economics, which means a prudent venue should offer a lower
loan-to-value ratio than it would against unrestricted collateral. That is a real cost
borne by real borrowers.

**We stop when we cannot price things.** The oracle is
[fail-closed](/blog/nav-is-not-a-price-feed): stale or implausible input halts new
borrows and halts liquidations rather than falling back to a number nobody stands
behind. It is the correct behaviour and it is still an outage.

**And it is a prototype.** Leontief runs on Stellar testnet. There is no mainnet
deployment, no completed audit, and no token — not one that is unlaunched, not one that
is coming; there is no token. What exists is a set of contracts, a set of tests, and
[a demo you can run yourself](https://app.leontief.tech) with test funds.

We would rather list those four things than have someone discover them later. A thesis
that only survives while nobody checks the details is not a thesis; it is a pitch. The
[protocol documentation](https://docs.leontief.tech/protocol/vault) is deliberately
more specific than this essay, and the contracts are more specific than the
documentation. Read down the stack until you stop believing us, and then read the
tests.

## Why this is worth building anyway

Because the alternative is a category of asset that grows every quarter and does
nothing.

Tokenized government debt is the part of this industry that most obviously works. It
has product-market fit with institutions that will never touch anything else. It is
growing because the underlying instrument is genuinely better on a ledger — divisible,
transferable at all hours, settling in seconds instead of days.

But "better savings account" is a small ambition for it. The thing that makes on-chain
finance interesting is not that assets move faster; it is that the same asset can be in
two arrangements at once — earning in one, pledged in another — with the ledger keeping
both stories straight. Tokenized treasuries have been excluded from that, not by
technology, but by the absence of a piece of infrastructure boring enough that nobody
wanted to build it.

That piece is a vault with an issuer-approved custody point, a share token, a
fail-closed valuation, and a liquidation path a lawyer will sign. None of it is
research. All of it is unglamorous. It is the difference between three billion dollars
of savings and three billion dollars of collateral.

## The measure that matters

Not total value locked. Not the size of the tokenized market, which will grow with or
without any of this.

The number worth watching is the share of tokenized real-world assets that are doing
more than one job at a time. Today it rounds to zero. Every point it moves is a
holder who kept their yield and got their liquidity, without anyone having to pretend
the rules did not apply.

That is the whole case. The assets are already safe. They should also be useful.
