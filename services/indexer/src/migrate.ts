import { migrate, sql } from "./db.js";

migrate()
  .then(() => {
    console.log("indexer: schema migrated");
    return sql.end();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
