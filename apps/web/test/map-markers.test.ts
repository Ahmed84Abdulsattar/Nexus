import { describe, expect, it } from 'vitest';
import { diffMarkers, toFeatureSpec } from '../src/components/map/arcgis/features';
import { markerToken } from '../src/components/map/colors';
import type { MapMarker } from '../src/components/map/types';
import { STATE_STATUS_TOKENS } from '../src/styles/tokens';

const marker = (over: Partial<MapMarker> = {}): MapMarker => ({
  id: 'a',
  kind: 'project',
  lat: 24.4,
  lng: 54.4,
  icon: 'generic',
  colorKey: 'active',
  label: 'A',
  ...over,
});

describe('markerToken: markers map to the right token', () => {
  it.each([
    ['project', 'active', 'state-active'],
    ['project', 'central_store', 'state-central-store'],
    ['project', 'finished', 'state-finished'],
    ['project', 'in_bid', 'state-in-bid'],
    ['asset', 'running', 'status-running'],
    ['asset', 'idle', 'status-idle'],
    ['asset', 'maintenance', 'status-maintenance'],
    ['asset', 'off', 'status-off'],
    ['asset', 'unknown', 'status-unknown'],
  ] as const)('%s / %s -> %s', (kind, colorKey, token) => {
    expect(markerToken({ kind, colorKey })).toBe(token);
  });

  it('falls back to the neutral token for a key with no token, never to another colour', () => {
    expect(markerToken({ kind: 'project', colorKey: 'unknown' })).toBe('status-unknown');
    expect(markerToken({ kind: 'asset', colorKey: 'brand_new_status' })).toBe('status-unknown');
    // An asset status never borrows a project-state colour, and the reverse.
    expect(markerToken({ kind: 'asset', colorKey: 'active' })).toBe('status-unknown');
    expect(markerToken({ kind: 'project', colorKey: 'running' })).toBe('status-unknown');
  });

  it('only ever returns one of the nine S0-06 tokens', () => {
    for (const kind of ['project', 'asset'] as const) {
      for (const colorKey of ['active', 'running', 'x', '']) {
        expect(STATE_STATUS_TOKENS).toContain(markerToken({ kind, colorKey }));
      }
    }
  });
});

describe('toFeatureSpec', () => {
  it('carries the token, id and coordinates to the layer', () => {
    const spec = toFeatureSpec(marker({ id: 'p1', colorKey: 'in_bid', lat: 25.1, lng: 55.2 }));
    expect(spec.attributes).toMatchObject({ id: 'p1', token: 'state-in-bid', kind: 'project' });
    expect([spec.lat, spec.lng]).toEqual([25.1, 55.2]);
  });
});

describe('diffMarkers (applyEdits input)', () => {
  const prev = new Map([marker({ id: 'a' }), marker({ id: 'b' })].map((m) => [m.id, m]));

  it('finds adds, updates and removes, and leaves unchanged markers alone', () => {
    const diff = diffMarkers(prev, [
      marker({ id: 'a' }), // unchanged
      marker({ id: 'c' }), // new
    ]);
    expect(diff.add.map((m) => m.id)).toEqual(['c']);
    expect(diff.update).toEqual([]);
    expect(diff.remove).toEqual(['b']);
  });

  it('updates a marker whose status changed or moved', () => {
    const diff = diffMarkers(prev, [
      marker({ id: 'a', colorKey: 'idle' }),
      marker({ id: 'b', lat: 25 }),
    ]);
    expect(diff.update.map((m) => m.id)).toEqual(['a', 'b']);
    expect(diff.add).toEqual([]);
    expect(diff.remove).toEqual([]);
  });
});
