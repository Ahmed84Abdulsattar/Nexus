import type { ConfigResponse } from '@nexus/shared';

/**
 * Project states Nexus stores (CHECK constraint on core.project.state in db/schema.sql; a test
 * compares this list with the database). Labels are made from the key, never typed here.
 */
export const PROJECT_STATE_KEYS = [
  'active',
  'central_store',
  'finished',
  'in_bid',
  'unknown',
] as const;

/** The bucket v_asset_live reports for a source value that status_map does not map. */
export const UNMAPPED_DISPLAY_STATUS = 'unknown';

/** ArcGIS styles (docs/09 sections 3 and 4). */
export const ARCGIS_BASEMAPS: ConfigResponse['arcgis']['basemaps'] = {
  map2d: 'arcgis/light-gray',
  satellite: 'arcgis/imagery',
  scene3d: 'arcgis/imagery',
};

/** UAE plus a margin (WGS84 degrees), and the first view: about 24.4 N, 54.4 E, zoom 7 (docs/09 section 3). */
export const UAE_EXTENT: ConfigResponse['arcgis']['extent'] = {
  xmin: 51.0,
  ymin: 22.0,
  xmax: 57.0,
  ymax: 26.6,
};
export const INITIAL_VIEW: ConfigResponse['arcgis']['initialView'] = {
  latitude: 24.4,
  longitude: 54.4,
  zoom: 7,
};

/** "central_store" becomes "Central store". */
export function labelFromKey(key: string): string {
  const words = key.replace(/[_\s]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function toEnumEntries(keys: readonly string[]): { key: string; label: string }[] {
  return [...new Set(keys)].map((key) => ({ key, label: labelFromKey(key) }));
}
