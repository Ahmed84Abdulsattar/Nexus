import { render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MapSurface, SurfaceFactory } from '../src/components/map/arcgis/viewManager';
import ArcgisMap from '../src/components/map/arcgis/ArcgisMap';
import type { MapLayerSpec, MapMode } from '../src/components/map/types';

// The SDK-facing factory is replaced; the real ViewManager and React component run.
const sdk = vi.hoisted(() => ({
  alive: new Set<string>(),
  created: [] as string[],
  destroyed: [] as string[],
  apiKeys: [] as string[],
}));
vi.mock('../src/components/map/arcgis/factory', () => ({
  configureArcgis: (key: string) => sdk.apiKeys.push(key),
  createArcgisFactory: (): SurfaceFactory => ({
    create: async (mode: MapMode): Promise<MapSurface> => {
      const id = `${mode}#${sdk.created.length + 1}`;
      sdk.created.push(id);
      sdk.alive.add(id);
      return {
        setLayers: () => undefined,
        setFocus: () => undefined,
        destroy: () => {
          sdk.alive.delete(id);
          sdk.destroyed.push(id);
        },
      };
    },
  }),
}));

const layers: MapLayerSpec[] = [{ id: 'markers', markers: [], cluster: false }];
const base = {
  apiKey: 'test-key',
  layers,
  focus: undefined,
  onMarkerClick: undefined,
  onViewChange: undefined,
};

function reset() {
  sdk.alive.clear();
  sdk.created.length = 0;
  sdk.destroyed.length = 0;
  sdk.apiKeys.length = 0;
}

describe('<ArcgisMap> adapter component', () => {
  it('2D -> satellite -> 3D leaves exactly one view, and unmount leaves none', async () => {
    reset();
    const view = render(<ArcgisMap {...base} mode="2d" />);
    await waitFor(() => expect([...sdk.alive]).toEqual(['2d#1']));

    view.rerender(<ArcgisMap {...base} mode="satellite" />);
    await waitFor(() => expect([...sdk.alive]).toEqual(['satellite#2']));

    view.rerender(<ArcgisMap {...base} mode="3d" />);
    await waitFor(() => expect([...sdk.alive]).toEqual(['3d#3']));
    expect(sdk.destroyed).toEqual(['2d#1', 'satellite#2']);

    view.unmount();
    expect(sdk.alive.size).toBe(0);
  });

  it('sets the key once through the adapter, and re-rendering does not re-create the view', async () => {
    reset();
    const view = render(<ArcgisMap {...base} mode="2d" />);
    await waitFor(() => expect(sdk.alive.size).toBe(1));
    view.rerender(<ArcgisMap {...base} mode="2d" layers={[...layers]} />);
    view.rerender(<ArcgisMap {...base} mode="2d" layers={[...layers]} />);
    expect(sdk.created).toHaveLength(1);
    expect(sdk.apiKeys).toEqual(['test-key']);
    view.unmount();
  });

  it('survives React StrictMode double mounting with a single live view', async () => {
    reset();
    const view = render(
      <StrictMode>
        <ArcgisMap {...base} mode="3d" />
      </StrictMode>,
    );
    await waitFor(() => expect(sdk.alive.size).toBe(1));
    view.unmount();
    expect(sdk.alive.size).toBe(0);
  });
});
