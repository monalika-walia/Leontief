# INTEGRATIONS/delegated-auth.md — delegated signing for Autopilot (A8 Tier 2)

**Researched: 2026-08-02.** Every contract ID below was confirmed live against
`soroban-testnet.stellar.org` on that date; every capability claim is quoted from
a spec, a contract source file, or an audit report and linked. Nothing here is
from memory (CLAUDE.md). This file is the **mandatory decision gate** for Tier 2:
Autopilot is not built until this says which path is real.

## Question

Can a user grant Leontief's Autopilot engine a signer that is **constrained
on-chain** — limited to specific contracts, capped in notional, floored at HF
1.6, expiring within 30 days — and revoke it in one tap?

## 1 · Protocol 27 delegated signing (CAP-0071)

[CAP-0071](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071.md)
— *"Authentication delegation and address-bound Soroban credentials"*, **Status:
Final, Protocol Version 27**. It is two sub-proposals:

> "CAP-71-01 specifies authentication delegation for custom accounts. CAP-71-02
> specifies `SOROBAN_CREDENTIALS_ADDRESS_V2`, which allows non-delegated address
> credentials to use the same address-bound authorization payload."

The XDR adds `SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES` and
`SorobanDelegateSignature` (nested delegation chains).

**What CAP-71 is not:** it is an *authentication* mechanism — how a custom
account can delegate proving "this invocation is authorized" to another address.
It defines no spend limits, no allow-lists, no expiry. Policy constraints are the
smart account's business, not the protocol's. Claiming CAP-71 as "on-chain
policy" would be wrong.

Client support: `@stellar/stellar-sdk` **v16.0.0** regenerated its XDR for CAP-71,
and per its
[CHANGELOG](https://github.com/stellar/js-stellar-sdk/blob/master/CHANGELOG.md)
*"CAP-71 `SOROBAN_CREDENTIALS_ADDRESS_V2` auth is opt-in; the default stays
legacy `SOROBAN_CREDENTIALS_ADDRESS` (V1)"*. This repo runs v16.2.0 and does not
opt in — nothing in our contracts needs address-bound credentials
(`INTEGRATIONS/stellar-js-sdk.md`).

## 2 · Smart-wallet policy signers (where the real constraints live)

The constraint machinery is the **OpenZeppelin Stellar smart-account framework**,
not the protocol. Per
[OpenZeppelin's docs](https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account):

> "Context rules function like routing tables for authorization. For each
> context, they specify scope, lifetime, and the conditions (signers and
> policies) that must be satisfied before execution proceeds."

> "Policies act as enforcement modules attached to context rules. They perform
> read-only prechecks and can update state to enforce limits or workflows."

The `ContextRule` struct
([storage.rs](https://github.com/OpenZeppelin/stellar-contracts/blob/main/packages/accounts/src/smart_account/storage.rs))
carries `valid_until: Option<u32>` — an expiry as a ledger sequence — with
`update_context_rule_valid_until()`, `add_signer()`, `remove_signer()` and
`remove_context_rule()`.

### Deployed and verified live on testnet

From `stellar/smart-account-kit`
[`docs/deployments-protocol-27-2026-07-09.md`](https://github.com/stellar/smart-account-kit/blob/main/docs/deployments-protocol-27-2026-07-09.md)
(Protocol 27, dated 2026-07-09). **Confirmed live 2026-08-02** by
`getLedgerEntries` on the contract instance of each:

| Component | Testnet contract ID | Live |
|---|---|---|
| WebAuthn verifier | `CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F` | ✅ |
| Ed25519 verifier | `CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4` | ✅ |
| Threshold policy | `CB3FATQKCIRIQOCYRUPCQ2KREQ7T4RPKS7EAEOZWPEPUKWEDRVROBCEG` | ✅ |
| Weighted-threshold policy | `CCMZ6X4KM3RC7HXWCZDTH7CMWIJXFPN6HLGKJBM63MCOW2AJ2V5W7YXY` | ✅ |
| Spending-limit policy | `CABXBYJNZ7IUW4G3D6BND5YCAQF3ASSDMDAOKQQ63UYFSO7WUU2TIP5G` | ✅ |

Library maturity: `stellar/smart-account-kit` (npm `smart-account-kit`, Apache-2.0,
**v0.4.0** with a `v0.7.0-rc.2` migration guide in-tree) and
`stellar/passkey-kit` — both moved from `kalepail/*` into the official Stellar
org, both pushed 2026-07-31. Pre-1.0, actively moving.

### The decisive limitation

**The shipped spending-limit policy cannot meter a Leontief action.** From
[`spending_limit.rs`](https://github.com/OpenZeppelin/stellar-contracts/blob/main/packages/accounts/src/policies/spending_limit.rs):

> "It intersects transfer operations and enforces spending limits over a
> configurable rolling time window."

```rust
if fn_name == &symbol_short!("transfer") {
    // ... spending limit check and history update
}
// …
panic_with_error!(e, SpendingLimitError::NotAllowed)
```

Any function name that is not `transfer` **panics** — so attaching this policy to
a rule covering the mini-pool would make `borrow` and `repay` fail outright, not
be metered. The doc also notes only the `CallContract` rule type is allowed, "as
it pins the policy to a specific token contract".

So, of the leash Tier 2 specifies, what is expressible on-chain **today**:

| Constraint | On-chain today? | How |
|---|---|---|
| Allowed contract IDs | ✅ | context rule scope (`CallContract`) / passkey-kit `SignerLimits` |
| Expiry ≤ 30 days | ✅ | `ContextRule.valid_until` (ledger sequence) |
| Revocation | ✅ | `remove_signer()` / `remove_context_rule()` |
| Require a co-signer | ✅ | threshold / weighted-threshold policies |
| Per-action notional cap on `borrow` | ❌ | needs a **custom policy contract** |
| Daily notional cap on protocol actions | ❌ | needs a **custom policy contract** |
| **HF floor 1.6** | ❌ | depends on mini-pool state; needs a custom policy that cross-reads the pool |

### Audit posture

[OpenZeppelin Stellar Contracts RC v0.7.0 audit](https://www.openzeppelin.com/news/stellar-contracts-rc-v0.7.0-audit),
**2026-03-02 → 2026-03-19**: 0 critical, 1 high, 6 medium, 9 low, 5 notes; all 18
resolved findings fixed. The High is worth reading before trusting a policy:

> "A sponsor can alter `context_rule_ids` after signatures are collected,
> selecting a weaker rule (fewer signers or fewer policies) for the same
> invocation."

That is a **silent downgrade that defeats exactly the spending limits and
threshold policies a user believed were in force** — fixed in PR #655, but it is
the failure mode this whole surface has to be judged against, and it was found
five months ago.

`stellar/passkey-kit`'s own README is blunt in the same direction:

> "Review the contract and SDK yourself before holding meaningful value."

and, on cap design:

> "a per-transfer cap alone is trivially drained by repeated capped transfers"

— which is why Tier 2 specifies a **daily** cap alongside the per-action one, not
instead of it.

## 3 · Decision — **Path B**, with the upgrade path to A recorded

**Policy-signer tooling is real, deployed, and audited — but it is not usable for
*this* grant, for two independent reasons:**

1. **Our users are not on smart accounts.** The live beta signs with Freighter /
   Stellar Wallets Kit against classic `G…` accounts (`app/src/ctx.tsx`). Path A
   presumes a contract account. Migrating the beta cohort onto passkey smart
   wallets is a larger, riskier change than Autopilot itself, and it is not what
   A8 asks for.
2. **Even on a smart account, the constraints that matter here are not
   expressible.** The per-action cap, the daily cap and the HF floor all need a
   custom policy contract that we would have to author, test to this repo's ≥90%
   coverage bar, and audit before mainnet. "Zero contract changes" is the whole
   posture of the A7/A8 stretch work.

→ **Path B**: a session keypair added as an **additional signer on the user's own
account**, with app-side one-tap revoke and tight engine-side limits.

### What Path B actually grants — stated plainly

A classic Stellar additional signer is **not scope-limited**. Weight and
thresholds decide *how much* authority it has, not *which contracts* it may
touch. Two consequences we do not paper over:

- The session key can sign anything at or below the account's **medium**
  threshold, including ordinary payments. The on-chain constraint is coarse.
- Therefore **the engine-side policy is the real leash**, and the engine is the
  thing that must be trustworthy. The on-chain part contributes exactly one
  guarantee, but it is the one that matters most: **revocation is unilateral and
  instant** — the user removes the signer and the engine's capability is gone,
  whatever the engine's code says.

Mitigations, in the ceremony:

- Session key gets **weight 1**; the account's **high threshold is raised above
  1** so the session key can neither add/remove signers nor change thresholds. No
  lockout, no privilege escalation.
- **Testnet-only assertion** in the signer path (same pattern as the A2-P demo
  signer), engine excluded from production builds unless `AUTOPILOT_FLAG`.
- Expiry is **not** expressible on a classic signer, so the engine enforces it and
  the UI states the expiry date next to the revoke button.

### Upgrade path to A (unchanged goal)

When the user cohort is on smart accounts, Path A becomes: one context rule
scoped to `CallContract` for {user's vault, mini-pool}, `valid_until` ≤ 30 days,
the session key as its signer, plus **a custom Leontief policy contract** for the
notional caps and the HF floor. That contract is the real work, and it needs an
audit — it is not a Tier-2 afternoon.

## 4 · What Tier 2 must do regardless of path

The HF floor of **1.6 is asserted by the engine's pre-flight simulation before
every action, on either path** — because on Path A it isn't expressible, and on
Path B nothing on-chain enforces it. That assertion is not a convenience; it is
the guarantee. It is unit-tested in `services/autopilot`, and the engine refuses
to act when a read fails (fail-closed, matching the oracle policy in spec §5).

## Open items

- The custom Leontief policy contract for Path A is unwritten and unaudited. Do
  not describe Autopilot as "on-chain-constrained" in any submission text while
  Path B is what ships — the honest sentence is in DECISIONS #11.
- `smart-account-kit` is pre-1.0 with an rc migration in flight; re-read this file
  before starting Path A, and re-verify the contract IDs (they are per-release).
