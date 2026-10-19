import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const themes = ['light', 'dark'] as const;
const paths = ['/projects/abc', '/admin/users'] as const;

async function open(page: Page, path: string, width: number, height: number, theme?: string) {
  await page.setViewportSize({ width, height });
  if (theme) await page.addInitScript((t) => localStorage.setItem('nexus.theme', t), theme);
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const theme of themes) {
  for (const path of paths) {
    for (const width of [1440, 1024, 390]) {
      test(`axe + no overflow: ${path} ${width}px ${theme}`, async ({ page }) => {
        await open(page, path, width, width === 390 ? 844 : 800, theme);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await noOverflow(page)).toBeLessThanOrEqual(0);
        const r = await new AxeBuilder({ page }).analyze();
        expect(r.violations.map((v) => v.id)).toEqual([]);
      });
    }
  }
}

for (const theme of themes) {
  test(`axe with drawer open (mobile bottom sheet) ${theme}`, async ({ page }) => {
    await open(page, '/projects/abc', 390, 844, theme);
    await page.getByRole('button', { name: 'Project details' }).click();
    await expect(page.getByRole('dialog', { name: 'Project details' })).toBeVisible();
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  test(`axe with drawer open (tablet left drawer) ${theme}`, async ({ page }) => {
    await open(page, '/projects/abc', 1024, 768, theme);
    await page.getByRole('button', { name: 'Assets' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assets' });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeCloseTo(0, 0);
    expect(box.height).toBeCloseTo(768, 0);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
}

test('drawer traps focus: Tab and Shift+Tab never leave the dialog; Esc returns focus', async ({
  page,
}) => {
  await open(page, '/projects/abc', 390, 844);
  const opener = page.getByRole('button', { name: 'Assets' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Assets' });
  await expect(dialog).toBeVisible();
  const insideDialog = () =>
    page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await insideDialog()).toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await insideDialog()).toBe(true);
  }
  // Background is inert to assistive tech while the modal is open.
  await expect(page.getByRole('banner')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('drawer closes on overlay click and the close button, focus returns to opener', async ({
  page,
}) => {
  await open(page, '/projects/abc', 1024, 768);
  const opener = page.getByRole('button', { name: 'Assets' });
  await opener.click();
  await page
    .getByRole('dialog', { name: 'Assets' })
    .getByRole('button', { name: /close/i })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await page.mouse.click(900, 400); // overlay, outside the 384px drawer
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('touch targets: every visible interactive control is at least 44x44 on mobile', async ({
  page,
}) => {
  await open(page, '/projects/abc', 390, 844);
  const small = await page.evaluate(() => {
    const out: string[] = [];
    document
      .querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [role="button"]')
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.width < 44 || r.height < 44) {
          out.push(
            `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
        }
      });
    return out;
  });
  expect(small).toEqual([]);
});

test('landmarks: one main, one banner, unique accessible names, no nested main', async ({
  page,
}) => {
  await open(page, '/projects/abc', 1440, 900);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('banner')).toHaveCount(1);
  expect(await page.locator('main main').count()).toBe(0);
  const regions = await page
    .getByRole('region')
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label') ?? e.getAttribute('aria-labelledby') ?? ''),
    );
  expect(regions.every(Boolean)).toBe(true);
  expect(new Set(regions).size).toBe(regions.length);
  const navs = await page
    .getByRole('navigation')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  expect(new Set(navs).size).toBe(navs.length);
});

test('components page (which owns its own main) has exactly one main with PageLayout demo', async ({
  page,
}) => {
  await open(page, '/dev/components', 1440, 900);
  await expect(page.getByRole('main')).toHaveCount(1);
});

test('breakpoint edges: 767 mobile, 768 tablet, 1279 tablet, 1280 desktop', async ({ page }) => {
  const cases = [
    { w: 767, list: 'button', details: 'button' },
    { w: 768, list: 'button', details: 'inline' },
    { w: 1279, list: 'button', details: 'inline' },
    { w: 1280, list: 'inline', details: 'inline' },
  ] as const;
  for (const c of cases) {
    await open(page, '/projects/abc', c.w, 800);
    const listRegion = page.getByRole('region', { name: 'Assets' });
    const detailsRegion = page.getByRole('region', { name: 'Project details' });
    await expect(listRegion).toHaveCount(c.list === 'inline' ? 1 : 0);
    await expect(detailsRegion).toHaveCount(c.details === 'inline' ? 1 : 0);
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  }
});

test('resizing while a mobile drawer is open does not leave a stuck overlay', async ({ page }) => {
  await open(page, '/projects/abc', 390, 844);
  await page.getByRole('button', { name: 'Project details' }).click();
  await expect(page.getByRole('dialog', { name: 'Project details' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Project details' })).toBeVisible();
  // The page must be interactive again (no leftover aria-hidden / pointer-events lock).
  await expect(page.getByRole('main')).toBeVisible();
  const locked = await page.evaluate(() => document.body.style.pointerEvents);
  expect(locked).not.toBe('none');
});
