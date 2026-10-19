import { describe, expect, it } from 'vitest';
import { configResponseSchema, projectMapPageSchema } from '../src/index.js';

const config = {
  arcgis: {
    apiKey: '',
    basemaps: {
      map2d: 'arcgis/light-gray',
      satellite: 'arcgis/imagery',
      scene3d: 'arcgis/imagery',
    },
    extent: { xmin: 51.0, ymin: 22.0, xmax: 57.0, ymax: 26.6 },
    initialView: { latitude: 24.4, longitude: 54.4, zoom: 7 },
  },
  enums: { projectStates: [{ key: 'active', label: 'Active' }], displayStatuses: [] },
  featureFlags: { weather: false },
};

describe('configResponseSchema (GET /v1/config)', () => {
  it('accepts an empty key (means "not configured") and rejects a missing key', () => {
    expect(configResponseSchema.safeParse(config).success).toBe(true);
    expect(
      configResponseSchema.safeParse({ ...config, arcgis: { ...config.arcgis, apiKey: undefined } })
        .success,
    ).toBe(false);
  });
  it('rejects non-boolean feature flags', () => {
    expect(configResponseSchema.safeParse({ ...config, featureFlags: { a: 'on' } }).success).toBe(
      false,
    );
  });
});

describe('projectMapPageSchema', () => {
  it('allows a project without coordinates', () => {
    const item = { id: 'a', name: 'A', state: 'active', latitude: null, longitude: null };
    expect(projectMapPageSchema.safeParse({ items: [item], nextCursor: null }).success).toBe(true);
  });
  it('rejects an out-of-range latitude', () => {
    const item = { id: 'a', name: 'A', state: 'active', latitude: 91, longitude: 0 };
    expect(projectMapPageSchema.safeParse({ items: [item], nextCursor: null }).success).toBe(false);
  });
});
