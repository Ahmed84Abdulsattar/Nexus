import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadEnv } from 'vite';
import { expectBasemapLoaded } from './basemap';

// The dev server (and its MSW /v1/config mock) reads the key from the git-ignored repo-root .env.
// This process reads ONLY VITE_DEV_ARCGIS_API_KEY from it (never the whole file), just to decide
// whether the real-map specs can run. Traces and videos stay off (playwright.config.ts) because
// the SDK puts the key in tile URLs.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const hasKey = Boolean(loadEnv('development', repoRoot, 'VITE_DEV_')['VITE_DEV_ARCGIS_API_KEY']);

const viewports = {
  xl: { width: 1440, height: 900 },
  sm: { width: 390, height: 844 },
} as const;

// The zoom (and in 3D the navigation and compass widgets) must not sit under the mode switch, and
// every ArcGIS button must be a 44 px touch target.
async function expectWidgetsClear(page: Page, map: Locator) {
  const modeBox = await page.getByRole('group', { name: 'Map mode' }).boundingBox();
  const buttons = map.locator('.esri-ui .esri-widget--button');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await buttons.nth(i).boundingBox();
    if (!box || !modeBox) continue;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const overlaps =
      box.x < modeBox.x + modeBox.width &&
      box.x + box.width > modeBox.x &&
      box.y < modeBox.y + modeBox.height &&
      box.y + box.height > modeBox.y;
    expect(overlaps, 'an ArcGIS widget overlaps the 2D/Satellite/3D switch').toBe(false);
  }
}

test.describe('lazy loading (no key needed)', () => {
  test('/admin/users loads no ArcGIS code', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(urls.filter((u) => /arcgis/i.test(u))).toEqual([]);
  });
});

test.describe('portfolio without a key (MSW mock)', () => {
  test.skip(hasKey, 'A key is set, so the map renders; see the real-key specs below.');

  for (const [name, viewport] of Object.entries(viewports)) {
    test(`shows "Map key not configured" and still lists the 10 projects at ${name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.getByText('Map key not configured')).toBeVisible();
      await expect(page.getByRole('listitem')).toHaveCount(10);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
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
        await expectBasemapLoaded(map); // a blank map (refused basemap) must fail here
        await expectWidgetsClear(page, map);
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
