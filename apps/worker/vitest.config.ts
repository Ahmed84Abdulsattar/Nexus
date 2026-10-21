import { defineConfig, mergeConfig } from 'vitest/config';
import { nest } from '@nexus/config/vitest';

// Database tests create and drop a migrated database in beforeAll / afterAll; on a loaded CI runner
// or laptop that takes longer than the 10 s default.
export default mergeConfig(nest, defineConfig({ test: { hookTimeout: 60_000 } }));
