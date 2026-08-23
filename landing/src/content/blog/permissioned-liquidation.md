---
title: "Permissioned Liquidation: How Restricted Collateral Gets Unwound Lawfully"
description: "A liquidation race cannot settle a security with holder conditions. The three-tier waterfall that can, what it costs, and what to ask a venue claiming one."
slug: permissioned-liquidation
pubDate: 2026-07-30
author: aditya
cluster: Permissioned liquidation
tags:
  - liquidation
  - restricted collateral
  - RWA
  - risk
  - Stellar
oneLine: "If the collateral has holder conditions, the liquidator needs them too — which turns a race into a waterfall, and turns speed into the thing you trade away for lawfulness."
siblings:
  - nav-is-not-a-price-feed
  - borrow-against-usdy-stellar
  - sep-8-sep-57-explained
---

Liquidation in DeFi is a race. A position crosses a threshold, the fact becomes
public, and whoever gets a transaction in first repays part of the debt and takes
collateral at a discount. It is elegant, it is permissionless, and for restricted
real-world assets it does not work — not because it is slow or expensive, but
because the winner of the race may not be allowed to own what they just won.

We call the alternative **permissioned liquidation**. This is what it is.

## Why the standard mechanism fails here

Take a tokenized note offered under Regulation S. Its holder conditions are not a
setting on a contract; they are terms in an offering document, and they bind whoever
holds the units at any moment. [SEP-8's authorization flags](/blog/sep-8-sep-57-explained)
are the ledger's way of enforcing them.

Now run a normal liquidation against that collateral. Three things break at once.

**The transfer may simply fail.** If the seizing account has no authorized trustline,
the ledger refuses. That is the good outcome: the system stops rather than doing
something wrong.

**If it succeeds, it may still be unlawful.** An issuer who has authorized a broad
set of accounts has made the transfer possible without making it appropriate.
Delivering a restricted security to an ineligible holder is not a settlement failure
to be unwound later; it is a transfer that should not have happened.

**The auction assumption evaporates.** Discount-driven liquidation works because
anyone with capital can compete, which is what keeps the discount honest. Restrict
the bidder set and the auction stops being an auction. You now have a small number of
approved parties who may or may not be paying attention at the moment you need them.

That last point is the one people underestimate. The legal problem is solvable. The
economic problem it creates — a liquidation mechanism that depends on specific named
parties choosing to act — is the design's real cost, and pretending otherwise is how
these systems fail in their first stress event.

## The waterfall, tier by tier

The answer is not one mechanism but three, in order, each with a timeout that hands
control to the next.

### Tier 1 — whitelisted liquidator

The ordinary path. A position's health factor falls below 1, and a liquidator drawn
from a whitelist the issuer has approved repays part of the debt and seizes
collateral at a bonus.

In the prototype the sequence is: check the whitelist, check that the position is
genuinely unhealthy, check the close factor, pull the repayment measured by balance
difference, reduce the position, seize shares with the bonus applied and rounding set
in the protocol's favour, transfer out, emit an event. The whitelist check comes
**first**, before any state is touched — a non-whitelisted caller gets a
`NotWhitelisted` error and nothing else happens. That rejection path is exercised in
the integration tests, not merely asserted in a comment.

Parameters: a 5% seize bonus, and a close factor of one half, so a single liquidation
can repay at most half the outstanding debt.

Tier 1 is fast and cheap when it works. It works when at least one whitelisted party
is watching and has stablecoin ready.

### Tier 2 — redemption unwind

When Tier 1 times out, the protocol stops looking for a buyer and goes to the source:
redeem the underlying with the issuer at net asset value and repay the debt from the
proceeds.

This is slower — issuer redemption is a business process with cut-off times, minimums
and settlement lag, not a ledger operation — and it needs a redemption adapter written
per issuer, because no two redemption APIs agree. But it removes the bidder problem
entirely. It does not need a liquidator; it needs the issuer to honour a redemption
they were always contractually obliged to honour.

### Tier 3 — issuer backstop

If both fail, what remains is a documented manual procedure with a signed runbook
agreed with the issuer in advance.

Calling this a "tier" is generous. It is a phone number and a piece of paper. But an
honest design says what happens in the worst case rather than leaving it implied, and
the discipline of having to write the runbook down is what surfaces the questions
nobody wants to ask during an incident.

## The whitelist economics

Here is the part that decides whether any of this survives contact with a real
market.

A whitelist is a bidder cartel by construction. Fewer bidders means a wider effective
discount, which means the bonus has to be large enough to pay approved liquidators for
capital, attention, and operational readiness — and every basis point of that bonus is
borne by the borrower being liquidated.

Three forces set the number:

- **How many names are on the list.** One name is a single point of failure with
  pricing power. Twenty names is a market. Most venues will start closer to one.
- **How long Tier 1 has before Tier 2 opens.** A short timeout limits borrower losses
  but makes redemption unwind common, and redemption unwind is operationally
  expensive. A long timeout is cheaper and leaves positions underwater longer.
- **How predictable the collateral is.** Short-dated treasury paper barely moves, so
  the capital-at-risk for a liquidator is small and the bonus can be modest. The same
  waterfall over volatile collateral would need a much larger one.

There is a design tension worth naming: the tighter the eligibility rules, the smaller
the whitelist, the worse the liquidation economics, and the lower the loan-to-value
ratio a prudent venue should offer. Restriction is not free. It is paid for in
borrowing capacity.

## What to ask any venue that claims to handle restricted collateral

If you are reviewing one — as a risk team, an issuer, or a depositor — these five
questions separate a design from a slogan.

1. **Who exactly may liquidate, and how does that list change?** "Approved parties" is
   not an answer. Ask for the mechanism, the current names, and who can add one.
2. **What happens when nobody on the list acts?** If there is no second tier, the
   answer is that the position stays underwater indefinitely and the shortfall lands
   on other depositors.
3. **Is the eligibility check enforced before state changes, and is the rejection path
   tested?** A check that runs after a transfer is not a check.
4. **Who bears the loss if redemption settles below the marked value?** Somebody does.
   A venue that has not decided in advance will decide under pressure.
5. **What does the oracle do when it cannot price the collateral?** If the answer is a
   fallback price, liquidation can be triggered against a number nobody stands behind.
   [Fail-closed is the only defensible policy](/blog/nav-is-not-a-price-feed),
   and it means new borrows and liquidations halt while withdrawals stay open.

## The risks, and our open questions

**This is a testnet prototype.** Tier 1 is implemented and tested. Tier 2 exists as a
design with a per-issuer adapter still to be written. Tier 3 is a document, not code.
There is no mainnet deployment and no token.

**Permissioned liquidation is slower than the alternative, always.** That is not a
bug to be optimised away; it is the price of lawfulness. A venue that advertises
restricted collateral with unrestricted liquidation speed has not solved the problem,
it has moved it.

Three things we genuinely have not settled, stated as questions rather than claims:

- **Whitelist governance.** Who curates the list at scale, and what stops it becoming
  a rent-seeking position? We have a mechanism and no satisfying answer to the
  incentive question.
- **Cross-issuer timeouts.** Tier 1's timeout should probably depend on the issuer's
  redemption cadence. We currently treat it as a per-pool constant, which is simpler
  and less correct.
- **Partial redemption.** If an issuer honours only part of a redemption request, the
  unwind is left half-done. The clean answer is probably to require whole-position
  redemption at Tier 2, and we are not certain that is right.

You can watch Tier 1 run — including the rejection path, where a non-whitelisted
caller is turned away — in [the testnet app](https://app.leontief.tech). Reading the
[contract source](https://docs.leontief.tech/addresses) is faster than reading this
post, and considerably more authoritative. If you are new to why restricted assets sit
still in the first place, start with [the idle $3B](/blog/idle-rwa-stellar).
