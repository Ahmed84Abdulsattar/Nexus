import { expect, type Locator } from '@playwright/test';

/** The message a failed basemap gives the developer. It names the port, never the key or a URL. */
export function basemapFailureMessage(port: number | string): string {
  return `ArcGIS refused the basemap. If your key has a referrer restriction, add http://localhost:${port} to it, or run with E2E_PORT=5173.`;
}

/**
 * Waits until the map container reports `data-basemap-status` loaded or failed, and fails the test
 * with a clear message on `failed`. A blank map must never pass.
 */
export async function expectBasemapLoaded(
  container: Locator,
  port: number | string = process.env['E2E_PORT'] ?? 5173,
): Promise<void> {
  const status = container.locator('[data-basemap-status]');
  await expect(status).toHaveAttribute('data-basemap-status', /^(loaded|failed)$/, {
    timeout: 30_000,
  });
  const value = await status.getAttribute('data-basemap-status');
  expect(value, basemapFailureMessage(port)).toBe('loaded');
}
