import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

// Migrations are read at config time and handed to the test worker as a
// binding, so every test file starts against a schema built exactly the way
// production is -- not a hand-maintained copy that drifts.
const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      singleWorker: true,
      miniflare: {
        compatibilityDate: '2026-08-01',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        bindings: {
          TEST_MIGRATIONS: migrations,
          ENVIRONMENT: 'test',
          MAX_RPM_PER_IP: '5',
          MAX_RPD_PER_IP: '30',
          CACHE_TTL_SECONDS: '3600',
          IP_HASH_SALT: 'test-salt',
          ADMIN_TOKEN: 'test-admin-token',
        },
        // AI and Vectorize are deliberately left unbound. Retrieval and
        // generation both have to degrade cleanly without them, and running
        // the suite that way is how we know they do.
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
