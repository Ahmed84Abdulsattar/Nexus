import { defineConfig, mergeConfig } from 'vitest/config';
import { base } from '@nexus/config/vitest';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['test/**/*.test.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
      environment: 'jsdom',
      // Route tests import lazy page chunks (the portfolio pulls in the query and map wrapper), which
      // is slow on a loaded CI machine or a full turbo run.
      testTimeout: 20_000,
      setupFiles: ['./test/setup.ts'],
    },
  }),
);
