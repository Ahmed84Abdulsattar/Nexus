import swc from 'unplugin-swc';

/**
 * Shared Vitest preset. Use with `mergeConfig(base, defineConfig({...}))`.
 * @type {import('vitest/config').UserConfig}
 */
export const base = {
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
    passWithNoTests: false,
  },
};

/**
 * Preset for NestJS packages: SWC keeps decorator metadata, which esbuild drops.
 * @type {import('vitest/config').UserConfig}
 */
export const nest = {
  ...base,
  plugins: [swc.vite()],
};
