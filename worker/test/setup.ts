import { applyD1Migrations, env } from 'cloudflare:test';

// Runs once per worker before any test file. Applies the same migration files
// that `wrangler d1 migrations apply` runs in production.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
