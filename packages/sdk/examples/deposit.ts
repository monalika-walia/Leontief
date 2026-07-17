// Wrap 10 LEOD as the demo user and print the minted shares.
//   source deploy.env && pnpm exec tsx packages/sdk/examples/deposit.ts
import { keypairSigner } from "../src/index.js";
import { clientFromEnv, fmt } from "./_env.js";

const client = clientFromEnv();
const signer = keypairSigner(process.env.DEMO_USER_SK ?? "", client.config.networkPassphrase);

const amount = 100_000_000n; // 10 LEOD
console.log("share price:", fmt(await client.sharePrice(), 12));
console.log(
  "quote      :",
  fmt(await client.quoteShares(amount)),
  "ldLEOD for",
  fmt(amount),
  "LEOD",
);
const { hash, returnValue } = await client.wrap(signer, amount);
console.log("minted     :", fmt(returnValue as bigint), "ldLEOD");
console.log("tx         : https://stellar.expert/explorer/testnet/tx/" + hash);
