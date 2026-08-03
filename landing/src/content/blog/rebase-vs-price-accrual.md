---
title: "Rebase vs Price-Accrual: One Accounting Formula for Every RWA Yield"
description: "Three tokens deliver yield three ways. A vault that measures instead of trusting needs one formula for all of them — here it is, with the arithmetic worked."
slug: rebase-vs-price-accrual
pubDate: 2026-08-27
author: monalika
cluster: RWA vault accounting
tags:
  - rebase
  - ERC-4626
  - vault accounting
  - Soroban
  - rounding
oneLine: "Rebase, price accrual, and distribution all end in the same place — the vault holds more value than it did — so one share-price formula covers all three, and the only hard parts are rounding and the first depositor."
siblings:
  - etherfuse-cetes-rebase
  - borrow-against-usdy-stellar
---

Three real-world-asset tokens, three ways of paying you, and a great deal of
integration code written on the assumption that there is only one.

## The three mechanics

**Price accrual.** Your balance never changes; each unit is worth more over time.
Ondo's USDY works this way — its yield is
[reflected through an increasing redemption price](/blog/borrow-against-usdy-stellar).
This is the friendliest shape, because nothing about your position moves without you.

**Rebase.** Your balance changes; the price stays put. You held 1,000 units, a rebase
runs, you hold 1,004. No transfer happened and no event you were subscribed to fired.
[Stablebond-style instruments](/blog/etherfuse-cetes-rebase) can deliver yield this way.

**Distribution.** Neither the balance nor the price changes on its own; instead a
payment arrives — a transfer of the same asset, or of a different one, on a schedule.
This is how most off-chain funds behave and how some on-chain ones do too.

They look like three engineering problems. They are one.

## The observation everything rests on

Ask what the *vault* experiences in each case, rather than what the holder experiences.

- Price accrual: the vault's balance is unchanged, the net asset value is higher, so
  the vault's holdings are worth more.
- Rebase: the net asset value is unchanged, the balance is higher, so the vault's
  holdings are worth more.
- Distribution: a transfer arrives, the balance is higher, so the vault's holdings are
  worth more.

Three mechanics, one outcome: **the vault's holdings are worth more than they were.**

If the share price is derived from what the vault actually holds — read fresh, every
time — then all three are already handled and none of them needs its own code path.
The mistake that creates three problems is storing a running total at deposit time and
trusting it afterwards.

## The formula

Two quantities, both read at the moment of the call: `S`, the shares outstanding, and
`V`, the value of the vault's holdings — its real balance, valued at the current net
asset value.

Minting:

```
value_in = received × nav / SCALE                         ⌊floor⌋
shares   = value_in × (S + VIRT) / (V + VIRT)             ⌊floor⌋
```

Redeeming:

```
value_out = shares × (V + VIRT) / (S + VIRT)              ⌊floor⌋
amount    = value_out × SCALE / nav                       ⌊floor⌋
```

with `SCALE = 10¹²` as the internal price scale and `VIRT = 10³` as a virtual offset
applied on **both** legs. `received` is not the amount the caller said they were
sending — it is the difference between the vault's balance before the transfer and
after it. Claimed amounts are inputs to a transaction, not facts about the world, and
a rebase that lands mid-transaction is captured for free by the second read.

`share_price` is quote units per share, `V × SCALE / S`. The net asset value enters the
valuation exactly once; anything downstream that multiplies by it again is
double-counting.

## Rounding has a direction

Every division above floors. That is not laziness — it is a policy, and it has to be
the same policy everywhere:

**Floor toward the user on what they receive. Ceiling toward the protocol on what they
owe.**

Mint fewer shares rather than more. Return less underlying rather than more. Seize
slightly more collateral rather than slightly less. Each individual rounding is worth
less than the last decimal place; the point is that they all lean the same way, so no
sequence of operations can round value *out* of the pool. A protocol that rounds
in the user's favour somewhere and the protocol's favour elsewhere has an arbitrage
loop in it, and someone will find the loop before the auditors do.

The consequence a user sees: a deposit-and-immediately-withdraw round trip returns
slightly *less* than it put in. Never more. That inequality is a tested invariant, not
an aspiration.

## Virtual shares, and the first depositor

The `VIRT` offset solves a problem that has nothing to do with yield.

The vault is empty. An attacker deposits the smallest possible amount, receiving a
tiny number of shares. They then send assets to the vault *directly*, without minting
— a donation. The vault's holdings jump; the share count does not. The share price is
now enormous. The next depositor's `value_in × S / V` floors to something far smaller
than it should, and the difference is claimable by the attacker.

Adding a constant to both sides of the ratio blunts this, because at small share counts
the constant dominates. Here is what it actually does, with the arithmetic run rather
than asserted. An attacker opens the vault with one stroop of value, donates 100.0000000
directly, and a victim then deposits 1,000.0000000:

| | Attacker's shares | Victim's shares | Victim can redeem | Victim's loss | Attacker can redeem |
|---|---|---|---|---|---|
| No offset | 1 | 9 | 990.0000000 | 10.0000000 | 110.0000000 |
| `VIRT = 10³` | 1 | 10,009 | 999.9910083 | 0.0089917 | 0.0999091 |

Without the offset the victim loses a full one percent of their deposit and the
attacker turns 100.0000001 into 110. With it, the victim loses under a thousandth of a
percent, and the attacker recovers about one tenth of one unit of the hundred they
donated. The attack does not merely stop working; it becomes an expensive way to
give strangers money.

Being precise about the guarantee, because it is easy to overstate: `VIRT = 10³` keeps
victim loss below one part in a million for donations up to roughly 10⁶ stroops. Past
that — as in the table above — what is enforced is weaker and still sufficient:
zero-share mints revert rather than silently taking the deposit, the victim's rounding
loss never exceeds the value of a single share, and the attacker's claim never exceeds
their outlay. A strict one-in-a-million bound at every donation size would need
`VIRT = 10⁶`, which the frozen spec does not authorise.

## Worked example

`SCALE = 10¹²`, seven-decimal asset, and every figure below is the integer result of
the formulas above.

**Alice opens the vault.** She deposits 1,000.0000000 units at a net asset value of
1.0209.

```
value_in = 1,020.9000000
shares   = 10,209,000,000          (S = 0, V = 0 → the offsets cancel)
share_price = 1.0000000000
```

**The asset accrues, two different ways.** Take the net asset value from 1.0209 to
1.0300 with the balance untouched — price accrual. Then, separately, hold the net
asset value at 1.0209 and let the balance rebase from 1,000.0000000 to 1,008.9137035.

```
price accrual → V = 1,030.0000000, share_price = 1.0089137036
rebase        → V = 1,030.0000000, share_price = 1.0089137035
```

The share prices differ by one unit in the tenth decimal place — floor-rounding dust
from converting a balance to a value, not a difference in meaning. Alice's claim is the
same either way, and the vault ran no rebase-specific code to get there.

**Bob arrives after the accrual.** He deposits the same 1,000.0000000 units, now worth
1,030.0000000:

```
value_in = 1,030.0000000
shares   = 10,209,000,008          Alice got 10,209,000,000
```

Bob contributed about 0.9% more value and received 0.00000008% more shares — which is
the correct answer, because Alice's shares appreciated in the meantime. He is buying
into a pool whose share price has already risen; the eight extra shares are rounding,
not a bonus.

**Alice exits immediately.** Redeeming all 10,209,000,000 shares at a net asset value
of 1.0300 returns 999.9999991 units — nine stroops less than the 1,000.0000000 she
deposited. Floor rounding, in the pool's favour, exactly as designed.

## Why this is the whole thing

There is no rebase handler in the vault. There is no distribution handler. There is a
balance read, a valuation, a ratio, and a rounding rule applied consistently.

That is the argument for measuring instead of trusting, stated as concretely as we can
make it: a vault that derives everything from what it currently holds is *automatically*
correct for accrual mechanics its authors never considered — including whatever the
next issuer invents.

The formulas above are implemented in the Leontief vault and documented in
[the protocol docs](https://docs.leontief.tech/protocol/vault); the golden vectors and
property tests that pin them live in the repository. You can watch the share price move
against a live net asset value feed in [the app](https://app.leontief.tech), on Stellar
testnet, where there is no mainnet deployment and no token.
