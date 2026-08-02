---
title: "The Idle $3B: Why Real-World Assets on Stellar Earn the Minimum"
description: "Stellar carries $3.07B of tokenized real-world assets and $221.76M of DeFi. The gap is not a liquidity problem — it is three rules working exactly as designed."
slug: idle-rwa-stellar
pubDate: 2026-08-03
updatedDate: 2026-08-24
author: monalika
cluster: RWA on Stellar
tags:
  - real world assets
  - Stellar
  - tokenized treasuries
  - collateral
oneLine: "Tokenized treasuries on Stellar earn their coupon and nothing else, because the same rules that make them lawful also make them unusable as collateral."
siblings:
  - productive-treasuries
  - sep-8-sep-57-explained
  - borrow-against-usdy-stellar
---

On 2 August 2026, [rwa.xyz counted $3.07B of tokenized real-world assets on
Stellar](https://app.rwa.xyz/networks/stellar) — 70 distinct assets, held across
19,110 accounts. Spiko's tokenized money market funds account for about $1.4B of
that. Franklin Templeton's on-chain fund accounts for roughly $560M. These are
regulated products holding short-dated government paper, and they are on Stellar
because Stellar settles cheaply and finally.

The same day, [DefiLlama put the total value locked across every DeFi protocol on
Stellar at $221.76M](https://defillama.com/chain/stellar).

Those two numbers measure different things, and it is worth being precise about
how. The first is the value of assets issued on the network. The second is the
value sitting inside lending pools, exchanges, and other contracts. One is not a
subset of the other. But the comparison still tells you something, because almost
none of that $221.76M is tokenized treasuries. Even if every dollar of Stellar
DeFi were a wrapped T-bill fund — and it is not close — it would account for about
seven percent of the RWA float.

The rest is doing exactly one thing: accruing. It earns whatever the underlying
paper earns, and then it stops.

## The assets are not idle by accident

It would be easy to read that gap as immaturity — not enough venues, not enough
integrations, give it time. That reading is wrong, and it leads to the wrong work.
The assets are idle because three rules are working exactly as intended.

**The issuer decides who may hold the asset.** Stellar's
[`AUTHORIZATION REQUIRED` flag](https://developers.stellar.org/docs/tokens/control-asset-access)
means an issuer must approve an account before that account can hold the asset;
approval is granted per trustline with a `SetTrustLineFlags` operation. A lending
pool is an account like any other. If the pool has not been individually
authorized by the issuer, a deposit into it fails — not for want of gas or
liquidity, but because the ledger enforced the issuer's compliance policy.

**The issuer can freeze, and often claw back.** `AUTHORIZATION REVOCABLE` lets an
issuer revoke an existing trustline's authorization, freezing the asset in place
and cancelling open orders. With `CLAWBACK ENABLED`, the issuer can reclaim units
outright. Both flags exist for good reasons — sanctions screening, court orders,
error correction. They also mean that anyone lending against this collateral is
underwriting the issuer's discretion alongside the credit of the U.S. Treasury.
Most lending protocols have no way to express that risk, so they decline it.

**Nobody has settled what a lawful liquidation looks like.** This is the rule that
gets least attention and matters most. Standard DeFi liquidation is a race: a
position crosses a threshold, and whoever arrives first buys the collateral at a
discount. For a Regulation S security with holder eligibility conditions, "whoever
arrives first" is not a legal category. Transferring the collateral to an
unqualified buyer is not a slow settlement — it is an unlawful one. There is no
mechanism in a permissionless liquidation engine that can check whether the winner
of the race is allowed to own what they just won.

Underneath all three sits a fourth thing that is not a ledger flag at all: holder
eligibility. A Regulation S offering is sold to non-U.S. persons; a Rule 144A
offering to qualified institutional buyers. Those categories are conditions on who
may own the security at any moment, not just who may buy it at issuance. The
authorization flags are the ledger's way of enforcing a policy that lives in an
offering document, and the offering document does not stop applying because the
holder moved the token into a smart contract.

None of these are bugs. Take any of them away and the asset stops being the
regulated instrument that made it worth tokenizing. The constraint is the product,
and any design that treats it as friction to be minimised has already lost the
argument it needs to win.

## What "productive" looks like where the rules are looser

The contrast is not subtle. On the same day, DefiLlama recorded
[$40.76B of DeFi TVL on Ethereum](https://defillama.com/chain/ethereum) against
Stellar's $221.76M. Ethereum's tokenized-treasury products sit inside curated
lending markets and isolated collateral pools, where a depositor can hold a
Treasury-backed token, pledge it, and borrow a stablecoin against it while the
underlying paper keeps paying.

Two things made that possible, and neither is a technical trick. The first is that
most collateral on Ethereum carries no holder restrictions at all, so the
liquidation question never arises. The second is that where restrictions do exist,
the market answered with **permissioned venues** — pools with a curator, an
allowlist of who may supply, and a named set of parties who may liquidate.

That second answer is the interesting one, because it generalizes. It says that
restricted collateral does not need permissionless liquidation; it needs
*lawful* liquidation, which is a different and smaller problem. Ethereum solved it
by building venues around the restriction rather than pretending the restriction
away. Stellar has better primitives for that job and has not yet used them.

The ratio is worth sitting with. Ethereum carries roughly 180 times Stellar's DeFi
TVL, but nothing about a T-bill fund cares which ledger records it. The assets are
identical instruments issued by the same managers. What differs is whether anything
exists on the other side of the deposit — and on Stellar, for restricted assets,
almost nothing does.

## What is actually different on Stellar

Stellar encodes the restriction at the protocol layer rather than in application
code. Authorization flags, trustlines, and the approval server pattern described in
[SEP-8](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0008.md)
are ledger features, not a token contract someone wrote — and the newer SEP-57 draft
extends the same idea into Soroban contracts. We walk through both in
[SEP-8 and SEP-57, explained](/blog/sep-8-sep-57-explained). That arrangement is
usually described as a limitation for DeFi. It is closer to the opposite.

When the rule lives in the ledger, a contract built on top does not have to
re-implement it, and cannot accidentally weaken it. A vault that holds a restricted
asset is subject to the same authorization checks as any other account. If the
issuer freezes, the freeze applies. There is no path where clever contract code
quietly routes around the issuer's policy, because the enforcement is not in the
contract.

What has been missing is the layer above: something that holds the restricted asset
under the issuer's rules, and issues a claim on it that ordinary DeFi can handle.
The restricted thing stays restricted. The composable thing is a share of a vault,
and the vault is the single account the issuer has to authorize — once — instead of
authorizing every counterparty a holder might ever want to trade with.

## What we are building

[Leontief](https://app.leontief.tech) is that layer, and it is a testnet prototype
today. There is no token, and there is no mainnet deployment.

A holder deposits a restricted asset into a per-asset vault and receives
`ld`-shares: a share token whose price rises as the underlying accrues. The share
is the composable object — it can be supplied as collateral or paired in a pool —
while the restricted asset never leaves the vault, and the vault is the account the
issuer authorizes. Pricing runs through a fail-closed oracle adapter: if the net
asset value is stale or moves further than the configured bound in one update, the
adapter halts pricing-dependent operations rather than guessing. Withdrawals and
repayments are never pausable.

Liquidation is where the design earns its keep. Seizure is gated on a whitelist of
parties the issuer has approved to receive the collateral, with a documented
waterfall for what happens when none of them acts. It is slower than a race. It is
also the only version that survives contact with a securities lawyer.

The mechanics are documented in
[the protocol docs](https://docs.leontief.tech/protocol/vault), and the contracts
are open source. If you want the loop rather than the argument, we walk through
deposit, pledge, borrow, and repay step by step in
[how to borrow against tokenized treasuries on Stellar](/blog/borrow-against-usdy-stellar).

## The number to watch

The $3.07B is not the interesting figure. It will keep growing on its own, because
issuing on Stellar is cheap and settlement is fast, and because the funds behind
those tokens are competing on distribution.

The figure that matters is the share of it that is doing more than one job at a
time. Today that share is close to zero, and the reason is not that anybody forgot
to build a lending pool. It is that a lending pool is the wrong shape for an asset
whose issuer must approve every holder and may reverse any transfer.

Something the right shape has to hold the restriction and hand back something that
composes — the argument for why that is worth doing at all is
[the case for productive treasuries](/blog/productive-treasuries). That is a narrow, unglamorous piece of infrastructure, and it is the one
missing piece between three billion dollars of collateral and a market that can
use it.
