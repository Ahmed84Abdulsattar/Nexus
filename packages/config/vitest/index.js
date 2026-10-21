import swc from 'unplugin-swc';

/**
 * Shared Vitest preset. Use with `mergeConfig(base, defineConfig({...}))`.
 * @type {import('vitest/config').UserConfig}
 */
export const base = {
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
    passWithNoTests: false,
    // Hooks do the expensive one-off work (building the test database template, a cold ESLint
    // load, dropping databases). Under turbo every package runs at once, so a hook can take
    // several times its idle time. The 10 s default failed on a loaded machine; a hook that really
    // hangs is still caught here, and tests keep their own (shorter) testTimeout.
    hookTimeout: 120_000,
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
