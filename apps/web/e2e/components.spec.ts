import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const viewports = {
  xl: { width: 1440, height: 900 },
  sm: { width: 390, height: 844 },
} as const;

for (const [name, viewport] of Object.entries(viewports)) {
  for (const theme of ['light', 'dark'] as const) {
    test(`components page at ${name}, ${theme} theme`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((t) => localStorage.setItem('nexus.theme', t), theme);
      await page.goto('/dev/components');
      await expect(page.getByRole('heading', { name: 'Components' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      // No horizontal page scroll at either width.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // Real-browser axe scan, including colour contrast.
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);

      await page.screenshot({
        path: `e2e/screenshots/components-${name}-${theme}.png`,
        fullPage: true,
      });
    });
  }
}
