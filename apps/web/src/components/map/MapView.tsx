import { lazy, Suspense, useMemo } from 'react';
import { useConfig } from '../../api/queries';
import { BrandRings } from '../brand';
import type { MapAdapterProps } from './adapter';
import type { MapLayerSpec, MapViewProps } from './types';

// The adapter (and with it the ArcGIS SDK) is a separate chunk, fetched only when a page renders a map.
const ArcgisMap = lazy(() => import('./arcgis/ArcgisMap')) as React.LazyExoticComponent<
  React.ComponentType<MapAdapterProps>
>;

/**
 * Message panel shown instead of the map. `brand` is the deliberate Slate empty state with the Aqua
 * ring device (loading, no key yet); `plain` is for a real failure and uses the neutral surface.
 */
function MapMessage({
  role,
  title,
  tone = 'brand',
  children,
}: {
  role: 'status' | 'alert';
  title: string;
  tone?: 'brand' | 'plain';
  children?: React.ReactNode;
}) {
  const brand = tone === 'brand';
  return (
    <div
      role={role}
      className={
        brand
          ? 'surface-slate relative flex size-full min-h-80 items-end overflow-hidden p-6 md:items-center md:p-12'
          : 'flex size-full min-h-80 items-center justify-center bg-surface p-6 text-center text-fg'
      }
    >
      {brand ? <BrandRings /> : null}
      <div className={brand ? 'relative max-w-md' : 'max-w-md'}>
        {brand ? (
          <span aria-hidden="true" className="mb-4 block size-3 rounded-full bg-brand-aqua" />
        ) : null}
        <p className={brand ? 'text-xl font-semibold tracking-tight' : 'font-semibold'}>{title}</p>
        {children ? <p className="mt-2 text-sm text-fg-muted">{children}</p> : null}
      </div>
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
      <MapMessage role="alert" tone="plain" title="Map settings could not be loaded">
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
      className={`relative min-h-80 overflow-hidden rounded-lg border border-border shadow-card ${className ?? ''}`}
    >
      {body}
      {overlays ? <div className="absolute inset-0 pointer-events-none">{overlays}</div> : null}
    </div>
  );
}
