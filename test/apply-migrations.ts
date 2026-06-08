import { env, applyD1Migrations } from "cloudflare:test";

// Apply the generated D1 migrations to the isolated test database before any
// test runs. The migration list is injected via the TEST_MIGRATIONS binding
// (see vitest.config.ts).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
