# INTEGRATIONS/stellar-js-sdk.md — JS SDK ⇄ network protocol compatibility

**Researched: 2026-08-02.** Reliability: **high** — the failure below was
reproduced live against `soroban-testnet.stellar.org` (protocol 27) before and
after the fix; every version claim is quoted from the official changelog.
Version-volatile by nature: re-check this file whenever the network upgrades
(CLAUDE.md).

## The bug this file exists to prevent

The repo pinned `@stellar/stellar-sdk@^13.1.0`. Against protocol-27 testnet,
**every write** threw inside the result poll:

```
TypeError: Bad union switch: 4
    at parseTransactionInfo (@stellar/stellar-sdk/lib/rpc/parsers.js)
    at rpc.Server.getTransaction
```

The transaction had already been **submitted and succeeded on-chain** — only the
client-side parse of its result meta failed. So the symptom is the worst kind:
the user sees an error, the chain sees a completed wrap/borrow/repay.

**Cause.** Protocol 23 introduced a new transaction-meta XDR version,
`TransactionMetaV4` (union arm 4), replacing `TransactionMetaV3`, as part of
CAP-0067 (classic operations emit SAC-format asset events). A v13 SDK's XDR has
no arm 4, so `TransactionMeta.fromXDR` rejects the switch value.
Sources: [Protocol 23 Upgrade Guide](https://stellar.org/blog/developers/protocol-23-upgrade-guide),
[CAP-0067](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md).

**Reads were never affected** — `simulateTransaction` returns no transaction
meta, which is why every dashboard/NAV surface kept working and this stayed
invisible until the first JS-signed write was polled to completion.

## Version → protocol map

Quoted from the [js-stellar-sdk CHANGELOG](https://github.com/stellar/js-stellar-sdk/blob/master/CHANGELOG.md)
(read 2026-08-02):

| SDK | Protocol | Changelog wording |
|---|---|---|
| v14.0.0 | 23 | "XDR has been upgraded to support **Protocol 23**" |
| v15.0.0 | 26 | "XDR has been upgraded to support **Protocol 26**" |
| v16.0.0 | 27 | "Protocol 27 support: the XDR was regenerated for CAP-71, and the Soroban authorization helpers can build and sign the new address-bound … credential types" |

Latest at time of writing: **16.2.0** (npm registry, 2026-08-02).
Testnet is on **protocol 27** (`getLatestLedger` → `"protocolVersion": 27`,
verified live 2026-08-02), matching the pinned `stellar-cli 27.0.0` in
DECISIONS #1.

**Rule: the JS SDK major must be ≥ the network protocol's supported line.** A
lagging SDK does not fail closed — it fails *after* the money has moved.

## What the repo pins now

`@stellar/stellar-sdk` `^16.2.0` in `packages/sdk`, `app`, `services/indexer`,
`services/monitor`, `landing`.

`@creit.tech/stellar-wallets-kit` `^2.5.0` — the v1.x line depends on
stellar-sdk 13.x, so the wallet layer had to move with it. v2 is a **static
singleton** API (`StellarWalletsKit.init/authModal/signTransaction/signMessage/
disconnect`) rather than v1's instance API with `allowAllModules()` /
`openModal()`; `app/src/ctx.tsx` was migrated accordingly.

### Breaking changes that touched this repo

- `nativeToScVal(v, { type: "bool" })` — the `"bool"` type hint is gone in v16.
  A JS boolean infers to `ScvBool`, so pass the value alone.
- CAP-71 `SOROBAN_CREDENTIALS_ADDRESS_V2` auth is **opt-in**; the default stays
  legacy V1. We do not opt in — nothing in the contracts requires address-bound
  credentials, and V1 keeps the signature path identical to what shipped.

## How to re-verify after a network upgrade

```sh
curl -s -X POST https://soroban-testnet.stellar.org \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | jq .result.protocolVersion
source deploy.env && pnpm exec tsx packages/sdk/examples/agent-treasury.ts
```

The example is the canary: it is the only script in the repo that drives the
full JS write path (10 signed transactions, polled to `SUCCESS`) end to end.
Reads alone will not catch a meta-version break.
