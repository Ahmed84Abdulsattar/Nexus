import { defineConfig, mergeConfig } from 'vitest/config';
import { base } from '@nexus/config/vitest';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['test/**/*.test.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
    },
  }),
);
