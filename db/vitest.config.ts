import { defineConfig, mergeConfig } from 'vitest/config';
import { base } from '@nexus/config/vitest';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      // The migration tests really are slow: up/down/up takes 7 s and the db:check agreement test
      // (pg_dump of a freshly migrated database) 27 to 33 s on an idle machine, and both took over 60 s
      // when all packages ran at once. Measured, not guessed; the work itself cannot be made cheaper.
      testTimeout: 180_000,
      hookTimeout: 120_000,
    },
  }),
);
