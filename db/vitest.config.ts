import { defineConfig, mergeConfig } from 'vitest/config';
import { base } from '@nexus/config/vitest';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      // Database tests create a database each; they take a few seconds.
      testTimeout: 60_000,
      hookTimeout: 120_000,
    },
  }),
);
