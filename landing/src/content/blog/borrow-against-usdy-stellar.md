---
title: "How to Borrow Against Tokenized Treasuries (USDY) on Stellar"
description: "USDY keeps accruing while you hold it. Here is the wrap-and-borrow loop that lets it also serve as collateral, the health factor in plain words, and the risks."
slug: borrow-against-usdy-stellar
pubDate: 2026-08-10
updatedDate: 2026-08-13
author: vyom
cluster: Borrowing against USDY
tags:
  - USDY
  - tokenized treasuries
  - collateral
  - Stellar
  - health factor
oneLine: "Wrap a restricted treasury token into a vault share, pledge the share, borrow a stablecoin against it — the underlying keeps accruing the whole time, and the restricted asset never leaves the vault."
siblings:
  - permissioned-liquidation
  - idle-rwa-stellar
  - sep-8-sep-57-explained
faq:
  - q: "Can a US person hold USDY?"
    a: "No. Ondo's eligibility policy prohibits persons who place buy orders from within the United States and persons who are US persons within the meaning of Rule 902 of Regulation S. Canada, Russia, Iran, North Korea, Cuba, Syria and several other jurisdictions are blocked entirely, and a number of others — Brazil, the EU and EEA, Hong Kong, Malaysia, Singapore, Switzerland and the UK among them — admit only professional or qualified investors above stated asset thresholds."
  - q: "Do I stop earning treasury yield while my position is pledged?"
    a: "No, and this is the point of the design. Yield on USDY is reflected through an increasing redemption price rather than a growing balance, so the accrual belongs to whoever holds the units. The vault holds them throughout, and the vault's share price rises with the underlying, so a pledged share accrues exactly as an idle one does."
  - q: "Is Leontief live on mainnet?"
    a: "No. Leontief is a testnet prototype. The walkthrough in this post runs on Stellar testnet against a stand-in restricted asset, not against USDY itself, and no mainnet deployment exists. There is also no token."
  - q: "What is the minimum to mint or redeem USDY on Stellar?"
    a: "Ondo's documentation lists a $5,000 minimum for minting and redeeming on its alternative networks, a group that includes Stellar alongside Sui, Aptos, XRP and Noble. That minimum is Ondo's, not a protocol limit, and it applies to the primary mint and redeem path rather than to secondary transfers."
  - q: "What happens if the oracle stops publishing?"
    a: "Pricing-dependent operations halt rather than fall back to a stale or guessed number. New borrows and liquidations stop until a fresh, in-bounds price arrives. Withdrawals and repayments are never pausable, so the exit stays open while the entrance is closed."
---

Ondo's USDY is a real instrument on Stellar. On 2 August 2026, DefiLlama recorded
[about $532M of Ondo yield assets on the network](https://defillama.com/chain/stellar).
Nearly all of it is doing one thing: sitting in accounts, appreciating.

This post is about the other thing it could be doing at the same time.

## What USDY actually is

Worth being precise, because the mechanics matter later.

[Ondo's documentation](https://docs.ondo.finance/general-access-products/usdy/basics)
describes USDY as a tokenized note — issued by Ondo USDY LLC, and as of 15 December
2025 folded into the Ondo Stocks umbrella. Depending on issuance date, it is secured
by "short-term US Treasuries, shares of iShares Short Treasury Bond ETF, or bank
demand deposits." You can mint with USDC; redemption to fiat runs by bank wire to
non-US bank accounts. On Stellar — grouped in Ondo's docs with Sui, Aptos, XRP and
Noble — there is a **$5,000 minimum for minting and redeeming**.

Two properties define how it behaves on-chain.

**It accrues by price, not by balance.** Yield is "reflected through an increasing
redemption price". Your unit count never changes; each unit is simply worth more
tomorrow. This is the friendliest possible shape for collateral, and it is why the
accounting in this post is simpler than it would be for a rebasing asset.

**It is a Regulation S instrument with real holder conditions.** Ondo's
[eligibility policy](https://docs.ondo.finance/general-access-products/usdy/faq/eligibility)
prohibits US persons within the meaning of Rule 902 of Regulation S, blocks a list of
jurisdictions outright, and admits several others only for professional or qualified
investors above stated thresholds. Those conditions apply to *holding*, not just to
buying.

## Why holding is not using

Put those two facts together and the problem appears on its own.

The asset earns. Good. But the moment you want it to do a second job — back a loan,
sit in a pool, serve as margin — you need to move it somewhere, and "somewhere" is a
contract, and a contract is an account that the issuer has to have found eligible.
Most have not been. The restriction that makes USDY a lawful security is the same
restriction that makes it inert.

The way out is not to weaken the restriction. It is to stop moving the restricted
thing around. Put it in one place the issuer can evaluate once, and hand the holder
back something unrestricted that represents their claim on it. We wrote about why
this is the only shape that works in
[the idle $3B](/blog/idle-rwa-stellar), and about the standards that enforce the
restriction in [SEP-8 and SEP-57, explained](/blog/sep-8-sep-57-explained).

## The loop, step by step

Everything below runs on **Stellar testnet**, against `LEOD` — a SEP-8-restricted
stand-in with the same authorization flags a real regulated asset carries. It is not
USDY. Leontief has no mainnet deployment, and wiring a live issuer's asset is a
mainnet conversation with that issuer, not something a testnet can simulate.
The addresses are in [the contract registry](https://docs.leontief.tech/addresses)
and every step is verifiable on stellar.expert.

**1. Deposit.** Send the restricted asset to the vault. The vault measures what it
actually received by balance difference rather than trusting the amount you claimed,
values it at the current net asset value, and mints you `ld`-shares.

**2. Hold the share.** `ldLEOD` is an ordinary SEP-41 token. It transfers freely,
because it is a claim on the vault, not the restricted asset itself. The vault is the
single account the issuer authorized.

**3. Pledge.** Supply the shares to the pool as collateral. They stay yours; the pool
records a position.

**4. Borrow.** Draw USDC against them, up to **80% of collateral value**. The
underlying keeps accruing the entire time — that is the part worth pausing on. Your
share price rises while the shares sit pledged, because accrual attaches to the
vault's holdings, not to whether you happen to be using them.

**5. Repay and withdraw.** Repay the USDC, unpledge, redeem the shares for the
underlying. Withdraw and repay are never pausable, by design and in code.

You can run the whole sequence in [the testnet app](https://app.leontief.tech) with
funded test accounts, and watch the positions move on
[the live performance page](https://leontief.tech/performance).

## Health factor, in plain words

The number the interface shows you is a ratio, and it means exactly one thing:
**how far your collateral can fall before someone else is allowed to sell it.**

The parameters in the prototype pool:

| Parameter | Value | What it does |
|---|---|---|
| Maximum LTV | 80% | The most you may borrow against collateral value |
| Liquidation threshold | 85% | Above this ratio of debt to collateral, the position is liquidatable |
| Liquidation bonus | 5% | The discount a liquidator receives on seized shares |
| Close factor | one half | The most of your debt a single liquidation may repay |

Health factor above 1 means the position is safe. At 1 it becomes eligible for
liquidation. Borrow the full 80% and you are starting with roughly 6% of headroom
between your debt ratio and the 85% threshold — not much, and treasury collateral
moves slowly, but the gap between "slowly" and "never" is where liquidations live.

The close factor is the humane part: a liquidation cannot take the whole position at
once. It repays at most half the debt and seizes the corresponding collateral plus
the bonus, which leaves a partially healed position rather than a wiped-out one.

Two things move the ratio in your favour without you doing anything. The underlying
accrues, which raises the collateral side. And the debt is a stablecoin, which does
not. A position opened at 80% and left alone drifts toward health rather than away
from it — the opposite of the usual experience of leverage, and a direct consequence
of collateral that pays a coupon.

## The risks, plainly

**This is a testnet prototype.** There is no mainnet deployment, no audit-completed
production system, and no token. Nothing here is an offer of anything, and no figure
in this post is a projection of a return.

**Oracle halts stop new activity.** Pricing runs through a fail-closed adapter. If
the net asset value goes stale or jumps further than the configured bound in one
update, the adapter refuses to price rather than guessing, and borrows and
liquidations stop until a good reading arrives. This is deliberate — the alternative
is a fallback price, and a fallback price is how collateral gets mispriced. It does
mean an oracle outage can leave you unable to open a new position for a while.
Withdrawals and repayments keep working.

**Liquidation is real, and it is permissioned.** If your health factor reaches 1, an
approved liquidator can repay part of your debt and take collateral at a 5% discount.
For restricted assets the liquidator set is a whitelist, which makes seizure lawful
but also means it depends on someone on that list choosing to act. The full mechanism,
including what happens when nobody does, is in
[permissioned liquidation](/blog/permissioned-liquidation).

**Issuer action is a live risk, not a theoretical one.** A regulated issuer can
freeze a trustline or claw back units. If that happens to the asset in a vault, the
vault is affected like any other holder. Per-asset isolation limits the blast radius
to one vault; it does not make the risk go away, and anyone lending against this
collateral is underwriting the issuer's discretion alongside the credit of the paper.

**Smart contract risk.** The contracts are open source and tested, and that is not
the same as being safe. Treat testnet as testnet.

## What would have to be true for this to matter

A holder with a real position needs three things that do not exist yet on mainnet:
an issuer willing to authorize a vault contract as an eligible holder, a liquidator
whitelist with names on it, and a production deployment that has been audited.

The first is a conversation. The second is a legal artifact. The third is work. None
of them are research problems, which is the encouraging part — the mechanism is
built, it runs, and you can watch it run today with test funds.
