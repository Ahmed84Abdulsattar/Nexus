import { describe, expect, it } from 'vitest';
import { ViewManager, type MapSurface } from '../src/components/map/arcgis/viewManager';
import type { MapLayerSpec, MapMode } from '../src/components/map/types';

/** A fake provider that records what is alive, so tests can assert "only one view exists". */
function fakeFactory() {
  const alive = new Set<string>();
  const log: string[] = [];
  const surfaces: { mode: MapMode; layers: MapLayerSpec[][]; destroyed: number }[] = [];
  let release: Array<() => void> = [];
  let hold = false;
  return {
    alive,
    log,
    surfaces,
    holdCreation() {
      hold = true;
    },
    finishCreation() {
      hold = false;
      release.forEach((r) => r());
      release = [];
    },
    factory: {
      async create(mode: MapMode): Promise<MapSurface> {
        const record = { mode, layers: [] as MapLayerSpec[][], destroyed: 0 };
        surfaces.push(record);
        const id = `${mode}#${surfaces.length}`;
        log.push(`create ${id}`);
        alive.add(id);
        if (hold) await new Promise<void>((resolve) => release.push(resolve));
        return {
          setLayers: (layers) => record.layers.push(layers),
          setFocus: () => undefined,
          destroy: () => {
            record.destroyed++;
            alive.delete(id);
            log.push(`destroy ${id}`);
          },
        };
      },
    },
  };
}

const layers: MapLayerSpec[] = [{ id: 'markers', markers: [], cluster: true }];
const container = () => document.createElement('div');

describe('ViewManager', () => {
  it('destroys the old view before creating the new one, so only one view exists', async () => {
    const f = fakeFactory();
    const manager = new ViewManager(f.factory, container());
    manager.setLayers(layers);

    await manager.setMode('2d');
    await manager.setMode('satellite');
    await manager.setMode('3d');

    expect(f.log).toEqual([
      'create 2d#1',
      'destroy 2d#1',
      'create satellite#2',
      'destroy satellite#2',
      'create 3d#3',
    ]);
    expect([...f.alive]).toEqual(['3d#3']);
    expect(f.surfaces.map((s) => s.destroyed)).toEqual([1, 1, 0]);
  });

  it('gives the new view the same layer data', async () => {
    const f = fakeFactory();
    const manager = new ViewManager(f.factory, container());
    manager.setLayers(layers);
    await manager.setMode('2d');
    await manager.setMode('3d');
    expect(f.surfaces[1]?.layers.at(-1)).toBe(layers);
  });

  it('does nothing when the mode has not changed', async () => {
    const f = fakeFactory();
    const manager = new ViewManager(f.factory, container());
    await manager.setMode('2d');
    await manager.setMode('2d');
    expect(f.surfaces).toHaveLength(1);
  });

  it('destroys a view that finishes creating after a newer switch', async () => {
    const f = fakeFactory();
    const manager = new ViewManager(f.factory, container());
    f.holdCreation();
    const first = manager.setMode('2d');
    const second = manager.setMode('3d');
    f.finishCreation();
    await Promise.all([first, second]);
    expect([...f.alive].sort()).toEqual(['3d#2']);
    expect(f.surfaces[0]?.destroyed).toBe(1);
  });

  it('destroys the view on unmount, even one still being created', async () => {
    const f = fakeFactory();
    const manager = new ViewManager(f.factory, container());
    await manager.setMode('2d');
    manager.destroy();
    expect(f.alive.size).toBe(0);

    const late = new ViewManager(f.factory, container());
    f.holdCreation();
    const pending = late.setMode('3d');
    late.destroy();
    f.finishCreation();
    await pending;
    expect(f.alive.size).toBe(0);
  });
});
