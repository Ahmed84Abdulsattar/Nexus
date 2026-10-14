import type { MapExtent, MapFocus, MapLayerSpec, MapMarker, MapMode } from './types';

/**
 * What a map adapter component receives. Provider-neutral; `MapView.tsx` lazy-loads the one adapter
 * (see the adapter folder). If the provider ever changes, only the adapter folder is replaced.
 */
export interface MapAdapterProps {
  /** Browser key for the map provider, from GET /v1/config. Never log or store it. */
  apiKey: string;
  mode: MapMode;
  layers: MapLayerSpec[];
  focus: MapFocus | undefined;
  onMarkerClick: ((marker: MapMarker) => void) | undefined;
  onViewChange: ((extent: MapExtent) => void) | undefined;
}
