import { render } from '@testing-library/react';
import axe from 'axe-core';
import { RouterProvider } from 'react-router';
import { afterEach, expect, it } from 'vitest';
import { createTestRouter } from '../src/app/router';

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

// jsdom has no layout or CSS, so axe cannot compute colour contrast here. Contrast is covered by
// test/tokens-contrast.test.ts (computed from tokens.css); the Playwright spec in e2e/ runs axe
// with contrast in a real browser.
it.each(['light', 'dark'] as const)(
  'components page has no axe violations (%s theme)',
  async (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container, findByRole } = render(
      <RouterProvider router={createTestRouter('/dev/components')} />,
    );
    await findByRole('heading', { name: 'Components' });
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([]);
  },
);
