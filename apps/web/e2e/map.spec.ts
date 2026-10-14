import { expect, test } from '@playwright/test';

// The dev server (and its MSW /v1/config mock) reads the key from the git-ignored repo-root .env.
// This process needs it only to decide whether the real-map specs can run, so load the same file.
try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // No .env: the real-map specs below skip.
}
const hasKey = Boolean(process.env['VITE_DEV_ARCGIS_API_KEY']);

const viewports = {
  xl: { width: 1440, height: 900 },
  sm: { width: 390, height: 844 },
} as const;

test.describe('lazy loading (no key needed)', () => {
  test('/admin/users loads no ArcGIS code', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(urls.filter((u) => /arcgis/i.test(u))).toEqual([]);
  });
});

// BLOCKED until an ArcGIS key exists (Q4, Q23): these need real basemap, elevation and 3D tiles.
test.describe('portfolio map with a real key', () => {
  test.skip(
    !hasKey,
    'BLOCKED: no ArcGIS key (VITE_DEV_ARCGIS_API_KEY empty; open questions Q4, Q23)',
  );

  for (const [name, viewport] of Object.entries(viewports)) {
    test(`UAE map switches 2D -> satellite -> 3D with one view at ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const map = page.getByRole('region', { name: 'Project map' });
      await expect(page.getByRole('listitem')).toHaveCount(10);

      const surface = map.locator('.esri-view-surface');
      for (const [mode, label] of [
        ['2d', '2D'],
        ['satellite', 'Satellite'],
        ['3d', '3D'],
      ] as const) {
        await page.getByRole('radio', { name: label }).check({ force: true });
        await expect(map).toHaveAttribute('data-map-mode', mode);
        await expect(surface).toHaveCount(1); // the old view was destroyed
        await expect(surface).toBeVisible();
        await page.waitForTimeout(5000); // let basemap tiles and elevation draw
        await page.screenshot({ path: `e2e/screenshots/map-${mode}-${name}.png` });
      }
    });
  }

  test('a keyboard user can pick a project from the list', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Sample project 01/ }).click();
    await expect(page.getByText('Selected: Sample project 01')).toBeVisible();
  });
});
