import { lazy, Suspense, useMemo } from 'react';
import { useConfig } from '../../api/queries';
import type { MapAdapterProps } from './adapter';
import type { MapLayerSpec, MapViewProps } from './types';

// The adapter (and with it the ArcGIS SDK) is a separate chunk, fetched only when a page renders a map.
const ArcgisMap = lazy(() => import('./arcgis/ArcgisMap')) as React.LazyExoticComponent<
  React.ComponentType<MapAdapterProps>
>;

function MapMessage({
  role,
  title,
  children,
}: {
  role: 'status' | 'alert';
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role={role}
      className="flex size-full flex-col items-center justify-center gap-1 bg-surface p-6 text-center text-fg"
    >
      <p className="font-semibold">{title}</p>
      {children ? <p className="max-w-md text-sm text-fg-muted">{children}</p> : null}
    </div>
  );
}

/**
 * The only map component pages import (docs/09). Provider-neutral: it reads the map key from
 * GET /v1/config, shows a clear state when there is no key, and lazy-loads the adapter.
 * Pass a memoised `focus`; a new object each render moves the camera each render.
 */
export function MapView({
  mode,
  markers,
  cluster = false,
  focus,
  onMarkerClick,
  onViewChange,
  overlays,
  label = 'Map',
  className,
}: MapViewProps) {
  const config = useConfig();
  const layers = useMemo<MapLayerSpec[]>(
    () => [{ id: 'markers', markers, cluster }],
    [markers, cluster],
  );

  let body: React.ReactNode;
  if (config.isPending) {
    body = <MapMessage role="status" title="Loading map…" />;
  } else if (config.isError) {
    body = (
      <MapMessage role="alert" title="Map settings could not be loaded">
        Reload the page to try again. If it keeps failing, tell the Nexus team.
      </MapMessage>
    );
  } else if (config.data.arcgis.apiKey.trim() === '') {
    body = (
      <MapMessage role="status" title="Map key not configured">
        The map needs an ArcGIS key from the Nexus configuration. Ask the Nexus team to set it up.
        The project list still works.
      </MapMessage>
    );
  } else {
    body = (
      <Suspense fallback={<MapMessage role="status" title="Loading map…" />}>
        <ArcgisMap
          apiKey={config.data.arcgis.apiKey}
          mode={mode}
          layers={layers}
          focus={focus}
          onMarkerClick={onMarkerClick}
          onViewChange={onViewChange}
        />
      </Suspense>
    );
  }

  return (
    <div
      role="region"
      aria-label={label}
      data-map-mode={mode}
      className={`relative min-h-80 overflow-hidden rounded-lg border border-border ${className ?? ''}`}
    >
      {body}
      {overlays ? <div className="absolute inset-0 pointer-events-none">{overlays}</div> : null}
    </div>
  );
}
