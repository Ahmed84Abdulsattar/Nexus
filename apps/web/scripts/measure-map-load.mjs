// Measures the JavaScript the browser downloads (gzipped) when a page opens vs. when the map opens.
// Run against `vite preview` of a production build:
//   VITE_API_BASE_URL=https://api.example.test/v1 pnpm --filter @nexus/web build
//   pnpm --filter @nexus/web preview --port 4173 &
//   node apps/web/scripts/measure-map-load.mjs [baseUrl]
// /v1/config and /v1/projects are answered by the script with a placeholder, non-working key, and
// every other request to a non-local host is aborted, so no real key is needed and nothing leaves the
// machine. The numbers are a lower bound: basemap layer modules load after the basemap answers,
// which needs a real key.
import process from 'node:process';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4173';

async function measure(path, withMap) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let bytes = 0;
  const files = new Set();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/v1/config')) {
      return route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: {
          arcgis: { apiKey: withMap ? 'placeholder-not-a-real-key' : '' },
          enums: { projectStates: [], displayStatuses: [] },
          featureFlags: {},
        },
      });
    }
    if (url.pathname.endsWith('/v1/projects')) {
      return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { items: [], nextCursor: null } });
    }
    if (url.origin !== base) return route.abort();
    return route.continue();
  });
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (url.origin !== base || !url.pathname.endsWith('.js')) return;
    const body = await response.body().catch(() => undefined);
    if (!body) return;
    bytes += gzipSync(body).length;
    files.add(url.pathname);
  });
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const arcgisFiles = [...files].filter(
    (f) => !/\/assets\/(index|PortfolioPage|AdminPage)/.test(f),
  );
  await browser.close();
  return {
    path,
    jsFiles: files.size,
    gzipMB: +(bytes / 1e6).toFixed(2),
    arcgisFiles: arcgisFiles.length,
  };
}

console.log(JSON.stringify(await measure('/admin/users', false)));
console.log(JSON.stringify(await measure('/', true)));
