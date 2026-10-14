import { expect, test } from '@playwright/test';

// QA addition for S0-09: needs no ArcGIS key. A phone-width check that the SDK is not fetched for
// a non-map route (the desktop version is in map.spec.ts).
test('/admin/users at a phone width loads no ArcGIS code and does not overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(urls.filter((u) => /arcgis|esri/i.test(u))).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
