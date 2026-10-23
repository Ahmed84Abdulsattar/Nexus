/** Pure helpers for the basemap load state. No @arcgis import, so they are unit-tested directly. */

export type BasemapStatus = 'loading' | 'loaded' | 'failed';

/** The abort the SDK raises when a view is destroyed mid-load. It is not a real failure. */
export function isAbortError(error: unknown): boolean {
  // Duck-typed: a DOMException is not always `instanceof Error` across realms.
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Turns a basemap load result into a status. An abort (our own destroy) returns undefined, so the
 * status is left alone; every other error is a real failure and must surface.
 */
export function basemapStatusFor(error: unknown): BasemapStatus | undefined {
  if (error === undefined) return 'loaded';
  return isAbortError(error) ? undefined : 'failed';
}
