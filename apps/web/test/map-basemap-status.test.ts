import { describe, expect, it } from 'vitest';
import { basemapFailureMessage } from '../e2e/basemap';
import { basemapStatusFor, isAbortError } from '../src/components/map/arcgis/basemapStatus';

describe('basemap status', () => {
  it('a clean load is loaded', () => {
    expect(basemapStatusFor(undefined)).toBe('loaded');
  });

  it('an AbortError (our own destroy) is ignored, not reported', () => {
    const abort = new DOMException('aborted', 'AbortError');
    expect(isAbortError(abort)).toBe(true);
    expect(basemapStatusFor(abort)).toBeUndefined();
  });

  it('any other error is a real failure and is not hidden', () => {
    expect(basemapStatusFor(new Error('403'))).toBe('failed');
    expect(basemapStatusFor('weird')).toBe('failed');
  });
});

describe('e2e failure message', () => {
  it('names the port and the 5173 fallback, and carries no URL token', () => {
    const message = basemapFailureMessage(5391);
    expect(message).toBe(
      'ArcGIS refused the basemap. If your key has a referrer restriction, add http://localhost:5391 to it, or run with E2E_PORT=5173.',
    );
    expect(message).not.toMatch(/token|key=/i);
  });
});
