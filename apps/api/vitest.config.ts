import { defineConfig, mergeConfig } from 'vitest/config';
import { nest } from '@nexus/config/vitest';

export default mergeConfig(
  nest,
  defineConfig({
    test: {
      // The PostgreSQL tests create and migrate a database in beforeAll; under a loaded machine
      // (turbo runs every package at once) that takes longer than the 10 s default.
      testTimeout: 30_000,
      hookTimeout: 120_000,
    },
  }),
);
