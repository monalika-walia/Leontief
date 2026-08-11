---
title: "SEP-8 and SEP-57, Explained: How Stellar Enforces Who Can Hold an Asset"
description: "Stellar has two answers for permissioned tokens: SEP-8 puts the rule in the ledger and an approval server; SEP-57 puts it in a Soroban contract. How each works."
slug: sep-8-sep-57-explained
pubDate: 2026-07-29
author: aditya
cluster: Permissioned tokens on Stellar
tags:
  - SEP-8
  - SEP-57
  - permissioned tokens
  - Stellar
  - compliance
oneLine: "SEP-8 enforces holder rules with ledger flags and a co-signing approval server; SEP-57 enforces them with a Soroban compliance hook — and neither asks a lending protocol to re-implement securities law."
siblings:
  - idle-rwa-stellar
  - borrow-against-usdy-stellar
---

Every conversation about real-world assets on a public ledger arrives at the same
question, usually about ten minutes in: if anyone can hold a token, how can a token
be a security?

Stellar has two answers, and they are different enough to be worth separating. One
is old, narrow, and lives in the ledger itself. The other is new, general, and lives
in a smart contract. Most of the confusion in this area comes from people arguing
about one while thinking about the other.

## The problem regulators actually solve

Start with what a regulator wants, because it is narrower than "control".

A Regulation S offering may be held by non-U.S. persons. A Rule 144A offering may be
held by qualified institutional buyers. A fund may need to block sanctioned
addresses, honour a court order, or reverse a transfer made in error. None of that
requires the issuer to approve every economic decision a holder makes. It requires
the issuer to be able to answer one question at transfer time — *is this recipient
allowed to hold this?* — and to be able to act when the answer changes after the
fact.

That is a much smaller demand than it first appears, and the two SEPs are two ways
of satisfying it.

## SEP-8: the rule lives in the ledger

[SEP-8, "Regulated Assets"](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0008.md),
has been active since 2017 and describes itself plainly: "Regulation sometimes
requires asset issuers to monitor and approve each transaction involving issued
assets and to enforce constraints."

It rests on two account flags the issuer must set, both documented in
[Stellar's asset-access guide](https://developers.stellar.org/docs/tokens/control-asset-access):

- **`AUTHORIZATION REQUIRED`** — an issuer must approve an account before that
  account can hold the asset. Approval is granted per trustline with a
  `SetTrustLineFlags` operation.
- **`AUTHORIZATION REVOCABLE`** — the issuer can revoke an existing trustline's
  authorization, freezing the asset held by that account and cancelling its open
  orders.

SEP-8 requires **both**. With only the first, an issuer could gate entry but never
respond to anything afterwards.

### The approval server, step by step

The flags are the enforcement; the approval server is the negotiation. A wallet that
wants to move a regulated asset does not simply submit to the network. It:

1. Builds the payment transaction and signs it.
2. `POST`s the base64 transaction XDR to the issuer's approval server.
3. Gets back one of five statuses.

The five are worth knowing by name, because they are the whole protocol:

| Status | HTTP | What it means |
|---|---|---|
| `success` | 200 | Approved as submitted; the server has added the issuer's signature |
| `revised` | 200 | Rewritten to comply and signed; the user must re-sign the new transaction |
| `pending` | 200 | Undecided; resubmit later, optionally after a stated timeout |
| `action_required` | 200 | The user must complete something at a returned URL first |
| `rejected` | 400 | Non-compliant and not fixable; an error string explains why |

The trick is in what "revised" produces. The approved transaction is not the user's
simple payment — the spec is explicit that what the server approves "consists of
operations that authorize the clients' accounts, transact the regulated asset, and
deauthorize the clients' accounts."

Read that sandwich carefully. Authorization is granted, the transfer happens, and
authorization is taken away again, all inside one atomic transaction. The steady
state for every holder is *unauthorized*. Nobody is standing on a permanent
allowlist; permission exists only for the width of a single ledger entry, and only
for a transfer the issuer has already inspected.

That last property has a consequence people building on top consistently miss. If
the steady state is unauthorized, then a contract that merely *holds* the asset
between transfers is in the same position as any wallet: it holds a balance it
cannot move without going back to the approval server. This is fine for custody and
fatal for anything that needs to move collateral on its own initiative — which is
precisely what a liquidation engine does. An issuer who wants an asset to work as
collateral has to decide, deliberately, to leave one specific account standing
authorized. That decision is the whole ballgame, and it is a compliance decision,
not an engineering one.

## SEP-57: the rule lives in a contract

[SEP-57, "T-REX (Token for Regulated EXchanges)"](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0057.md),
is a **draft** at version 0.3.0, and it answers the same question for the Soroban
era. Where SEP-8 leans on classic-ledger flags and an off-chain server, SEP-57
specifies contracts.

Three pieces matter:

- **`RWAToken`** extends an ordinary fungible token with the operations a regulated
  instrument needs: forced transfers, mint and burn, freezing at both the account
  and the token level, and balance recovery.
- **A compliance module** with "one hook per operation (`transferred`, `created`,
  `destroyed`)". The hooks enforce policy by panicking on rejection while recording
  state changes in the same transaction — so there is no separate "may I?" call that
  could return stale advice before the transfer lands.
- **An `IdentityVerifier`** exposing `verify_identity()` and `recovery_target()`.
  The spec leaves the implementation deliberately abstract: claims-based registries,
  Merkle trees, zero-knowledge proofs, or something bespoke all satisfy it.

The design point is the one-hook-per-operation shape. A check that runs *as part of*
the state change cannot disagree with the state change. A check that runs beside it
eventually will.

Two of those capabilities deserve a second look from anyone underwriting the asset.
**Forced transfer** means the issuer can move units between holders without the
sender's signature. **Balance recovery** means units can be reassigned from a lost or
compromised account to a replacement. Both are necessary — a fund with a court order
and no way to comply is not a fund anyone will list — and both mean that possession
of the token is not the same as final title to the asset. A lender who treats a
restricted token as bearer collateral has misread what they are holding.

## Why neither is a lending protocol's problem

Here is the part that matters if you are building on top rather than issuing.

The alternative to both SEPs is the pattern most chains ended up with: every venue
re-implements the eligibility rules in its own contract. A lending pool grows an
allowlist. A DEX grows a different one. A vault grows a third, subtly out of date.
Each is a place where the rule can be implemented wrongly, and each has to be
re-audited when the rule changes.

Putting the check in the ledger or in the asset's own contract collapses that. There
is one implementation, owned by the party with the legal obligation, and applications
above it inherit the behaviour whether or not their authors thought about it. A
contract that holds a SEP-8 asset is subject to the same trustline authorization as
a personal wallet. There is no clever call path that quietly routes around the
issuer, because the enforcement is not in the caller.

That is also why the honest architecture for RWA collateral is not "teach the pool
about securities law". It is: hold the restricted asset in one account the issuer has
authorized, and issue an unrestricted claim on it that ordinary contracts can handle.
The restricted thing stays restricted and stays enforced by the issuer. The
composable thing is a share. This is exactly the shape
[the Leontief vault](https://docs.leontief.tech/protocol/vault) takes, and the reason
[so little of Stellar's tokenized-asset float is doing any work](/blog/idle-rwa-stellar)
is that almost nobody has built that middle piece yet.

## What it means in practice

**If you hold a regulated asset:** your transfers may be rewritten before they
settle, and under SEP-8 your authorization is normally off between transfers. A
wallet that does not speak the approval-server flow will show you failures it cannot
explain. That is the protocol working, not a bug.

**If you issue one:** SEP-8 is active, specified since 2017, and needs no Soroban.
SEP-57 is a draft — powerful, contract-native, and appropriate for instruments whose
policy is too rich for a trustline flag, but it is not yet a finished standard, and
building against a draft is a decision to make deliberately rather than by default.

**If you build venues:** do not reimplement eligibility. Design so that the
restricted asset is held in as few authorized places as possible, and so that every
other contract in your system touches only the unrestricted claim. Then the only
question a reviewer has to ask is whether that one custody point is correct — and
that is a question that can actually be answered.

You can see the vault-and-share pattern running against a live testnet deployment in
[the Leontief app](https://app.leontief.tech), and the deposit-pledge-borrow-repay
sequence is written out step by step in
[how to borrow against tokenized treasuries on Stellar](/blog/borrow-against-usdy-stellar).
It is a prototype, on testnet, and there is no token.
