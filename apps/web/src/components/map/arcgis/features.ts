import { markerToken } from '../colors';
import type { MapMarker } from '../types';

/**
 * Pure marker-to-feature mapping used by the ArcGIS layer. It imports nothing from @arcgis, so it is
 * unit-tested without the SDK (docs/09 section 7).
 */
export interface FeatureAttributes {
  id: string;
  kind: MapMarker['kind'];
  label: string;
  colorKey: string;
  icon: string;
  /** The state or status token (`state-active`, `status-running`, ...) that colours the symbol. */
  token: string;
}

export interface FeatureSpec {
  attributes: FeatureAttributes;
  lat: number;
  lng: number;
}

export function toFeatureSpec(marker: MapMarker): FeatureSpec {
  return {
    attributes: {
      id: marker.id,
      kind: marker.kind,
      label: marker.label,
      colorKey: marker.colorKey,
      icon: marker.icon,
      token: markerToken(marker),
    },
    lat: marker.lat,
    lng: marker.lng,
  };
}

export interface MarkerDiff {
  add: MapMarker[];
  update: MapMarker[];
  /** Marker ids that are no longer present. */
  remove: string[];
}

const changed = (a: MapMarker, b: MapMarker) =>
  a.lat !== b.lat ||
  a.lng !== b.lng ||
  a.colorKey !== b.colorKey ||
  a.label !== b.label ||
  a.icon !== b.icon ||
  a.kind !== b.kind;

/** What `applyEdits` must do to turn the layer holding `prev` into one holding `next`. */
export function diffMarkers(prev: ReadonlyMap<string, MapMarker>, next: MapMarker[]): MarkerDiff {
  const seen = new Set<string>();
  const add: MapMarker[] = [];
  const update: MapMarker[] = [];
  for (const marker of next) {
    seen.add(marker.id);
    const old = prev.get(marker.id);
    if (!old) add.push(marker);
    else if (changed(old, marker)) update.push(marker);
  }
  const remove = [...prev.keys()].filter((id) => !seen.has(id));
  return { add, update, remove };
}
