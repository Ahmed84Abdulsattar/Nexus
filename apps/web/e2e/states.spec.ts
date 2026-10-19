import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const viewports = {
  xl: { width: 1440, height: 900 },
  sm: { width: 390, height: 844 },
} as const;

// The dev MSW service worker would answer /health/live before page.route sees it (S0-09).
test.use({ serviceWorkers: 'block' });

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

for (const [name, viewport] of Object.entries(viewports)) {
  test(`loading, empty, error and retry states at ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));

    await page.route('**/health/live', async (route) => {
      calls += 1;
      if (calls === 1) {
        await gate; // loading is visible until released
        return route.fulfill({ status: 204 }); // no body: empty
      }
      if (calls === 2) {
        return route.fulfill({
          status: 429,
          headers: { 'content-type': 'application/problem+json', 'Retry-After': '9' },
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Too Many Requests',
            status: 429,
            detail: 'Slow down',
          }),
        });
      }
      if (calls === 3) {
        return route.fulfill({
          status: 403,
          headers: { 'content-type': 'application/problem+json' },
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            detail: 'Nope',
          }),
        });
      }
      return route.fulfill({ json: { status: 'ok' } });
    });

    await page.goto('/dev/states');

    // Loading
    await expect(page.getByRole('status').first()).toContainText('Loading API health');
    await axeClean(page);
    await page.screenshot({ path: `e2e/screenshots/states-loading-${name}.png`, fullPage: true });

    // Empty
    release();
    await expect(page.getByText('The API answered without a body.')).toBeVisible();
    await expect(page.getByText('No data yet').first()).toBeVisible();
    await axeClean(page);
    await page.screenshot({ path: `e2e/screenshots/states-empty-${name}.png`, fullPage: true });

    // Missing value renders a dash, never 0
    await expect(page.getByText('Power:')).toContainText('—');
    await expect(page.getByText('Power:')).not.toContainText('0');

    // Error (429 with Retry-After), via a refetch from a fresh load
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Retry after 9 s');
    await expect(page.getByRole('alert')).toContainText('Too Many Requests: Slow down');
    await axeClean(page);
    await page.screenshot({ path: `e2e/screenshots/states-error-${name}.png`, fullPage: true });

    // Retry with the keyboard: next response is 403 (no retry button), then success
    await page.getByRole('button', { name: 'Try again' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('No access');
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await axeClean(page);

    await page.reload();
    await expect(page.getByText('Status:')).toContainText('ok');
    await axeClean(page);
    await page.screenshot({ path: `e2e/screenshots/states-content-${name}.png`, fullPage: true });
  });
}
