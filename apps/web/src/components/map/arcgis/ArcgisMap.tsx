import { useEffect, useRef, useState } from 'react';
import type { MapAdapterProps } from '../adapter';
import type { BasemapStatus } from './basemapStatus';
import { configureArcgis, createArcgisFactory, type SurfaceHandlers } from './factory';
import { ViewManager } from './viewManager';

/**
 * The ArcGIS adapter (docs/09). Lazy-loaded by components/map/MapView.tsx. One `ViewManager`
 * lives per mounted component; it keeps one view alive and destroys it on a mode switch and on
 * unmount. Views are kept out of React state (refs only), so a re-render never re-creates them.
 */
export default function ArcgisMap({
  apiKey,
  mode,
  layers,
  focus,
  onMarkerClick,
  onViewChange,
}: MapAdapterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<ViewManager | undefined>(undefined);
  const handlers = useRef<SurfaceHandlers>({});
  const [basemap, setBasemap] = useState<BasemapStatus>('loading');

  useEffect(() => {
    handlers.current = { onMarkerClick, onViewChange, onBasemapStatus: setBasemap };
  }, [onMarkerClick, onViewChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    configureArcgis(apiKey);
    const manager = new ViewManager(
      createArcgisFactory(() => handlers.current),
      container,
    );
    managerRef.current = manager;
    return () => {
      manager.destroy();
      managerRef.current = undefined;
    };
  }, [apiKey]);

  useEffect(() => {
    void managerRef.current?.setMode(mode);
  }, [mode, apiKey]);

  useEffect(() => {
    managerRef.current?.setLayers(layers);
  }, [layers, apiKey]);

  useEffect(() => {
    managerRef.current?.setFocus(focus);
  }, [focus, apiKey]);

  // data-basemap-status is the e2e hook: tests wait for "loaded". Pins and the list keep working
  // when the tiles fail; only a quiet notice is added.
  return (
    <div className="relative size-full" data-basemap-status={basemap}>
      <div ref={containerRef} className="size-full" />
      {basemap === 'failed' ? (
        <p
          role="status"
          className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm text-fg-muted shadow-card"
        >
          Map tiles could not be loaded
        </p>
      ) : null}
    </div>
  );
}
