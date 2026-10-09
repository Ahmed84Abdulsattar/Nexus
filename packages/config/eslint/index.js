import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { boundaries } from './boundaries.js';

/** Root ESLint flat config for the whole monorepo. */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      // GENERATED files
      'apps/web/src/api/schema.d.ts',
      'apps/api/openapi.json',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: { 'import-x': importX },
    rules: {
      'import-x/first': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',
      'import-x/newline-after-import': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { files: ['apps/web/**'], languageOptions: { globals: { ...globals.browser } } },
  {
    ignores: ['apps/web/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/web/*.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Nest relies on runtime constructor types for DI, so type-only import rewriting is unsafe.
  {
    files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  ...boundaries,
  prettier,
);
