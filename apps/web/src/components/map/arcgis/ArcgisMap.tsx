import { useEffect, useRef } from 'react';
import type { MapAdapterProps } from '../adapter';
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

  useEffect(() => {
    handlers.current = { onMarkerClick, onViewChange };
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

  return <div ref={containerRef} className="size-full" />;
}
