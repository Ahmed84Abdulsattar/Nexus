import { defineConfig, mergeConfig } from 'vitest/config';
import { base } from './vitest/index.js';

export default mergeConfig(base, defineConfig({ test: { testTimeout: 30_000 } }));
