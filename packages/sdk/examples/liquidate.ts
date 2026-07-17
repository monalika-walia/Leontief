// Check a target's health and liquidate up to the close factor (whitelisted key).
//   source deploy.env && TARGET=<G...> pnpm exec tsx packages/sdk/examples/liquidate.ts
import { keypairSigner, quoteSeize, SCALE } from "../src/index.js";
import { clientFromEnv, fmt } from "./_env.js";

const client = clientFromEnv();
const signer = keypairSigner(process.env.DEMO_LIQUIDATOR_SK ?? "", client.config.networkPassphrase);
const target = process.env.TARGET ?? process.env.ALICE ?? "";

const hf = await client.healthFactor(target);
console.log("target hf :", (Number(hf) / 1e12).toFixed(4));
if (hf >= SCALE) {
  console.log("healthy — nothing to liquidate");
  process.exit(0);
}
const pos = await client.positions(target);
const repay = pos.debt / 2n; // close factor
const sp = await client.sharePrice();
console.log("repay     :", fmt(repay), "USDC → seize ≈", fmt(quoteSeize(repay, sp)), "ldLEOD");
const { hash, returnValue } = await client.liquidate(signer, target, repay);
console.log("seized    :", fmt(returnValue as bigint), "ldLEOD");
console.log("tx        : https://stellar.expert/explorer/testnet/tx/" + hash);
