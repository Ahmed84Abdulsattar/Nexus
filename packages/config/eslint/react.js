import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * React rules (docs/11, docs/14: hooks correctness and WCAG AA linting). Applied to apps/web only.
 */
export const react = [
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ['apps/web/**/*.{ts,tsx}'],
  },
];
