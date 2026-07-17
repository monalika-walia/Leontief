// Supply 5 ldLEOD as collateral and borrow 2 USDC against it.
//   source deploy.env && pnpm exec tsx packages/sdk/examples/borrow.ts
import { keypairSigner } from "../src/index.js";
import { clientFromEnv, fmt } from "./_env.js";

const client = clientFromEnv();
const signer = keypairSigner(process.env.DEMO_USER_SK ?? "", client.config.networkPassphrase);

await client.supplyCollateral(signer, 50_000_000n);
const { hash } = await client.borrow(signer, 20_000_000n);
const pos = await client.positions(signer.address);
const hf = await client.healthFactor(signer.address);
console.log("position  :", fmt(pos.collateral_shares), "ldLEOD /", fmt(pos.debt), "USDC debt");
console.log("health    :", (Number(hf) / 1e12).toFixed(3));
console.log("tx        : https://stellar.expert/explorer/testnet/tx/" + hash);
