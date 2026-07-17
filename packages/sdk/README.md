# @leontief/sdk

Typed TypeScript client for the [Leontief](https://github.com/monalika-walia/Leontief)
protocol on Stellar — wrap restricted RWAs into composable **ld-shares**, borrow
against them, and liquidate, from Node or the browser.

```ts
import { LeontiefClient, keypairSigner } from "@leontief/sdk";

const client = new LeontiefClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contracts: { vault, miniPool, oracleAdapter },
  assetId: "LEOD",
});

// Reads need no keys (simulateTransaction under the hood):
await client.sharePrice();               // 1_002_100_000_000n  (SCALE = 10^12)
await client.quoteShares(100_000_000n);  // ≈ ld-shares for 10 LEOD

// Writes take any Signer (raw key here; wallets-kit/Freighter in the browser):
const me = keypairSigner(secret, client.config.networkPassphrase);
const { hash, returnValue } = await client.wrap(me, 100_000_000n);
```

## Design

- **One client, two paths.** Reads simulate (`simulateTransaction`), so they need
  no account or keys. Writes run the full build → simulate → assemble → sign →
  send → poll cycle and never resolve until the tx reaches `SUCCESS` (or throw).
- **`Signer` is just `{ address, sign(xdr) }`.** A `keypairSigner` ships for
  scripts/bots; browser wallets (Freighter, xBull via `@creit.tech/stellar-wallets-kit`)
  satisfy the same shape — the dApp uses exactly this interface.
- **Fail-closed reads surface as `ContractError`** with the `.code` parsed from
  `Error(Contract, #N)` — e.g. a stale/deviating oracle throws instead of
  returning a stale price, matching the contract's policy.
- **Pure previews** (`quoteShares`, `quoteWithdraw`, `healthFactor`, `quoteSeize`)
  mirror the contracts' integer math for instant UI estimates. They are
  advisory — the chain enforces exact amounts on submit — and are unit-tested
  against the repo's golden vectors so they can't silently drift.

## Layers

`@leontief/sdk` (this package, hand-written & stable) sits on top of
`stellar-sdk`. Raw generated bindings live in `packages/bindings/*` — regenerated
from the live contracts by `scripts/gen_bindings.sh` after every deploy, and
gitignored. Prefer this SDK; drop to the bindings only for a method not surfaced
here.

## Examples

```sh
source deploy.env                                    # VAULT, MINI_POOL, … + demo SKs
pnpm exec tsx packages/sdk/examples/deposit.ts       # wrap 10 LEOD
pnpm exec tsx packages/sdk/examples/borrow.ts        # supply + borrow USDC
TARGET=G... pnpm exec tsx packages/sdk/examples/liquidate.ts
```

## Test

```sh
pnpm --filter @leontief/sdk test        # pure-math parity vs golden vectors
LEONTIEF_LIVE=1 pnpm --filter @leontief/sdk test   # + live testnet read smoke
```

MIT.
