import type { ReactNode } from 'react';

/** The three site-map modes (docs/09 section 4). 3D is the simple 3D of ADR 0008. */
export type MapMode = '2d' | 'satellite' | '3d';

/**
 * One point on the map. Pages build these from API data; the map shows exactly what it is given.
 * Provider-neutral: nothing here refers to ArcGIS.
 */
export interface MapMarker {
  /** Asset or project id. */
  id: string;
  kind: 'project' | 'asset';
  lat: number;
  lng: number;
  /** Asset-type icon key from the API (`'tower-crane'`, `'generator'`, ...) or `'generic'`. */
  icon: string;
  /**
   * Project state key (`'active'`, `'central_store'`, ...) when `kind` is `'project'`, or the
   * display-status key (`'running'`, `'idle'`, ...) when `kind` is `'asset'`. The colour comes from
   * the matching token; an unknown key is drawn with the neutral `status-unknown` token.
   */
  colorKey: string;
  label: string;
  /** Recent status change. 2D only; 3D never pulses (ADR 0008). Not drawn until the live task. */
  pulse?: boolean;
  data?: Record<string, unknown>;
}

/** A named set of markers drawn as one client-side layer. */
export interface MapLayerSpec {
  id: string;
  markers: MapMarker[];
  /** Group nearby markers. Used in 2D and satellite only; SceneView has no clustering. */
  cluster: boolean;
}

export interface MapExtent {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  zoom: number;
}

export type MapFocus = { lat: number; lng: number; zoom: number } | { fitTo: 'markers' };

export interface MapViewProps {
  mode: MapMode;
  markers: MapMarker[];
  cluster?: boolean;
  focus?: MapFocus;
  onMarkerClick?(marker: MapMarker): void;
  onViewChange?(extent: MapExtent): void;
  /** Legend, mode switch, "coming later" buttons. Drawn over the map. */
  overlays?: ReactNode;
  /** Accessible name of the map region. */
  label?: string;
  className?: string;
}
