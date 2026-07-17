import { migrate, sql } from "./db.js";

migrate()
  .then(() => {
    console.log("migrated: early_access");
    return sql.end();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
