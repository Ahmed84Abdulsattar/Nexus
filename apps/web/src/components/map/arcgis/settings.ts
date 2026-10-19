import type { MapMode } from '../types';

/**
 * ArcGIS basemap ids per mode (docs/09 sections 3 and 4). They are Esri service names, not data.
 * The key needs the basemap, elevation and (for 3D buildings) 3D content privileges.
 */
export const BASEMAP_BY_MODE: Record<MapMode, string> = {
  '2d': 'arcgis/navigation',
  satellite: 'arcgis/imagery',
  '3d': 'arcgis/imagery',
};

/** World elevation for the simple 3D mode (ADR 0008). */
export const GROUND_3D = 'world-elevation';

/**
 * Esri's OpenStreetMap 3D buildings scene service (Living Atlas, "where available"). Its service
 * metadata answers without a key; rendering it needs the key's 3D privilege. Confirm with the real
 * key when Q23 is answered.
 */
export const BUILDINGS_3D_URL =
  'https://basemaps3d.arcgis.com/arcgis/rest/services/OpenStreetMap3D_Buildings_v1/SceneServer';

/** Camera tilt over the site in 3D (docs/09 section 4). */
export const TILT_3D = 60;

export const CLUSTER_RADIUS = '60px';
