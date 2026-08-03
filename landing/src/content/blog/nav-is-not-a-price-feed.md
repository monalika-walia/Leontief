---
title: "NAV Is Not a Price Feed: Fail-Closed Oracle Design for RWAs"
description: "A spot price is what someone paid. A net asset value is what a fund says its holdings are worth. Confusing the two is how RWA collateral gets drained."
slug: nav-is-not-a-price-feed
pubDate: 2026-08-20
author: aditya
cluster: RWA oracle design
tags:
  - oracle
  - NAV
  - fail-closed
  - Reflector
  - risk
oneLine: "A spot price is a trade; a net asset value is an assertion by the fund. Price a real-world asset off the order book and you have written a loan against whoever moves it last."
siblings:
  - permissioned-liquidation
  - borrow-against-usdy-stellar
---

Ask a lending protocol what an asset is worth and it will consult an oracle. For most
crypto collateral that is the right question, and the oracle gives a defensible answer.
For a tokenized treasury fund, the question is subtly wrong, and the wrongness is
expensive.

## Spot and NAV are different objects

A **spot price** is the record of a trade. It says: at this moment, one party paid this
much. Its authority comes entirely from the depth behind it. In a liquid market that
authority is enormous — thousands of participants would have to agree to move it. In a
thin one it is nearly zero, because one participant can move it alone.

A **net asset value** is not a trade at all. It is the fund's own statement of what its
holdings are worth, computed from the underlying instruments, published on a real-world
cadence, and standing behind the redemption a holder is entitled to. Nobody's order
sets it. The Treasury market and the fund's administrator set it.

For a tokenized treasury fund, NAV is the correct valuation and the market price is a
sideshow — a secondary quote that may drift for reasons that have nothing to do with
the paper. Redemption is at NAV. Collateral should be valued the same way.

This is not a fine distinction. It is the difference between a number one trader can
move and a number one trader cannot.

## The failure modes

Three of them, in increasing order of how badly they end.

**Stale.** The feed stops updating. Nothing errors; the last value simply sits there.
The protocol keeps pricing collateral off a number that is hours or days old, and if
the underlying moved in the meantime, every position is mispriced in the same direction
at once. Staleness is the failure mode that looks most like health, because a constant
price is indistinguishable from a calm market.

**Deviation.** A value arrives that is possible but not plausible. Short-dated
government paper does not gap. If a NAV jumps several percent between two consecutive
updates, the interesting question is not "how do we price that" but "what happened to
our data path", and the only safe answer is to stop.

**Manipulation.** The value is genuine and the source is compromised in its premises.
This is the one the ecosystem learned the hard way.

### The 2026 incident, plainly

On 22 February 2026, a lending pool operated by YieldBlox DAO on Blend V2 lost
[more than $10M](https://blocksec.com/blog/yieldblox-dao-incident-on-stellar-oracle-misconfiguration-enabled-a-10m-drain).
The mechanism deserves to be stated without editorialising, because it is instructive
rather than embarrassing.

The pool accepted USTRY — a tokenized-treasury asset — as collateral, valued through a
Reflector oracle path that drew from the USTRY/USDC market on Stellar's decentralised
exchange. That order book was shallow. The attacker cleared the resting orders and
placed abnormal ones, pushing the apparent market price sharply higher. The oracle
faithfully reported what it saw. The pool faithfully valued the collateral at the
reported price, and the attacker borrowed against it and left.

BlockSec's analysis is careful about where the fault sat: "This incident was not a
Blend V2 core-contract issue. It was a pool-operator configuration issue," and the core
problem was that "collateral valuation in this pool depended on a manipulable price
source."

That sentence is the entire lesson, and it is worth resisting the urge to draw a
larger one. The oracle was not broken. The lending contracts were not broken. Someone
pointed a valuation at a thin order book for an asset whose real value was published
elsewhere, by the fund, every day. The failure was a category error about what kind of
number a treasury asset has.

We are not writing this from a position of superiority. Our contracts are unaudited and
on testnet. But the design below exists specifically because of this class of failure,
and it would be dishonest to describe it without saying where it came from.

## Fail-closed, and what that costs

Our adapter is [fail-closed](https://leontief.tech/litepaper#sec-b) — it reverts unless **all three** hold:

1. the reading is fresh — `now − ts ≤ max_age`;
2. the move is bounded — `|nav − last_accepted| / last_accepted ≤ max_deviation`;
3. the feed is configured and the value is non-zero.

On success, `last_accepted` advances. On any failure the call returns an error, and
every operation that needs a price halts. There is **no fallback price**. Not a cached
one, not an average, not a slightly-stale-but-probably-fine one.

That last point is where the argument usually happens, so let us be direct about the
trade. A fallback price keeps the protocol available during an outage. It does so by
inventing a number that no one stands behind, at exactly the moment the system has
admitted it does not know what things are worth. Availability during an outage is not
a feature when the thing being made available is the ability to borrow against a
guess.

What fail-closed costs is real: an oracle outage stops new borrows and stops
liquidations. Positions that would have been liquidated are not, and the protocol
carries that risk until pricing returns. We accept that cost because the alternative
concentrates the loss on depositors instead of spreading it across time.

**Exits are never affected.** Withdraw and repay do not consult the oracle and are not
pausable. If the system cannot price your collateral, you can still take it back and
you can still pay down your debt. A halt closes the entrance, never the exit.

## What a user sees when it halts

Not a blank screen and not a stale number presented as fresh. The interface shows the
last accepted NAV with its timestamp, marks the feed as halted, and disables the
actions that would need a price — borrow, and liquidate. Deposit, withdraw, and repay
stay live. The health factor is displayed as of the last accepted reading, explicitly
labelled as such, because a number with a known age is honest and a number without one
is not.

You can see the live path — a Reflector SEP-40 feed on testnet, normalised and
bounds-checked by the adapter — running in
[the app](https://app.leontief.tech) and on
[the performance page](https://leontief.tech/performance).

## Parameters

| Parameter | Default | Why this value |
|---|---|---|
| `max_age` | 90,000 s (25 h) | NAV publishes on a real-world cadence, not per block. A day plus an hour of slack tolerates a normal publication schedule and nothing more. |
| `max_deviation` | 200 bps per update | Short-dated government paper does not gap. A larger move is a data-path problem, not a market event. |
| Scale | `10¹²` | One internal price scale everywhere; source decimals are normalised on the way in. |
| Fallback price | none | There is no configuration that enables one. |
| Re-arm | admin `accept_override` | Prototype-only escape hatch. Emits a loud event that monitoring treats as an incident, and is a candidate for removal or timelocking before mainnet. |

Two of these deserve a note. The defaults are **per asset** and configurable, because
25 hours is right for a daily-published treasury NAV and wrong for something that
publishes weekly. And `accept_override` is a real hole in an otherwise clean policy —
it exists so testnet drills can recover a halted feed without a redeploy. We would
rather document it plainly than pretend the escape hatch is not there.

## What this means for anyone building on RWAs

Three rules fall out of the incident above, and none of them are novel.

**Value the asset the way its issuer redeems it.** If redemption is at NAV, price at
NAV. A market quote for a restricted, thinly traded instrument is a number about the
order book, not about the asset.

**Assume the thinnest venue is the one that will be used against you.** An oracle that
aggregates across sources is only as strong as the weakest path it will accept.

**Decide in advance what happens when you do not know the price**, and write it down
before you need it. Halting is a policy. Guessing is also a policy, chosen by omission,
and it is the one that pays out to whoever is watching.

The mechanics are documented in
[the vault and adapter docs](https://docs.leontief.tech/protocol/vault). If you want
the downstream consequence — what a halt means for someone whose collateral is being
unwound — that is [permissioned liquidation](/blog/permissioned-liquidation), and the
borrower's-eye view is in
[how to borrow against tokenized treasuries](/blog/borrow-against-usdy-stellar).
