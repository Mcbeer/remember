import { defineConfig } from "drizzle-kit";

// Schema lives in TS; drizzle-kit generates SQL migrations into ./migrations,
// which are then applied with `wrangler d1 migrations apply`.
export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./src/worker/db/schema.ts",
  out: "./migrations",
});
