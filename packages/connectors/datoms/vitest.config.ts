import { defineConfig, mergeConfig } from 'vitest/config';
import { base } from '@nexus/config/vitest';

export default mergeConfig(base, defineConfig({}));
