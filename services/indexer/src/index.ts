// Runs the poller loop and the REST API together (one process for the MVP).
import { buildApi } from "./api.js";
import { PORT } from "./config.js";
import { migrate } from "./db.js";
import { pollLoop } from "./poller.js";

async function main() {
  await migrate();
  const app = await buildApi();
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`indexer API on :${PORT}`);
  await pollLoop(); // never returns
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
