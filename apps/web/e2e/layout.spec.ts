import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const widths = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
const pages = [
  { name: 'project', path: '/projects/abc' },
  { name: 'admin', path: '/admin/users' },
  { name: 'components', path: '/dev/components' },
] as const;

for (const vp of widths) {
  for (const pg of pages) {
    test(`${pg.name} at ${vp.width}px: no horizontal overflow, one main, axe clean`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(pg.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await expect(page.getByRole('main')).toHaveCount(1);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
      await page.screenshot({
        path: `e2e/screenshots/layout-${pg.name}-${vp.width}.png`,
        fullPage: true,
      });
    });
  }
}

test('project page: desktop shows list and details inline', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/projects/abc');
  await expect(page.getByRole('region', { name: 'Assets' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Project details' })).toBeVisible();
});

test('project page: tablet collapses the list to a button, details stay inline', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/projects/abc');
  await expect(page.getByRole('region', { name: 'Assets' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Project details' })).toBeVisible();
  await page.getByRole('button', { name: 'Assets' }).click();
  await expect(page.getByRole('dialog', { name: 'Assets' })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/layout-project-1024-list-open.png' });
});

test('project page: mobile panels open as bottom drawers with 44px targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/projects/abc');
  for (const name of ['Assets', 'Project details']) {
    const opener = page.getByRole('button', { name });
    const box = await opener.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    await opener.click();
    const dialog = page.getByRole('dialog', { name });
    await expect(dialog).toBeVisible();
    // Bottom sheet: full width, attached to the bottom edge of the viewport.
    const d = (await dialog.boundingBox())!;
    expect(d.width).toBeCloseTo(390, 0);
    expect(d.y + d.height).toBeCloseTo(844, 0);
    expect(d.y).toBeGreaterThan(0);
    await page.screenshot({
      path: `e2e/screenshots/layout-project-390-${name === 'Assets' ? 'list' : 'details'}-drawer.png`,
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
});
