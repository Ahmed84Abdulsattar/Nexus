import { defineConfig, mergeConfig } from 'vitest/config';
import { nest } from '@nexus/config/vitest';

export default mergeConfig(nest, defineConfig({}));
