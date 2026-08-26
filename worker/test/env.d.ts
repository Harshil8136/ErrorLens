import type { D1Migration } from 'cloudflare:test';
import type { Env as WorkerEnv } from '../src/types';

// `env` from cloudflare:test is typed as Cloudflare.Env, so the project's own
// bindings have to be merged into that global namespace rather than into a
// ProvidedEnv interface (which is what older pool versions exposed).
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      /** Injected by vitest.config.ts so test/setup.ts can apply migrations. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
