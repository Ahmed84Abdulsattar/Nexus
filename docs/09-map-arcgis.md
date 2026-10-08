# 09 · Map: Esri ArcGIS

**Decision:** Esri ArcGIS is the map provider (`adr/0002-map-arcgis.md`). This replaces sprint task S0-09, which was the provider comparison.

**Why ArcGIS:**
- Real 3D (SceneView with terrain and buildings) for the Satellite / 2D / 3D switch.
- The strongest path to BIM later (ArcGIS GeoBIM, Building Scene Layers / I3S, IFC support).
- Enterprise GIS that Innovo can grow into.
- Built-in clustering and large point layers.

## 1. Library and setup
- `@arcgis/core` (ArcGIS Maps SDK for JavaScript, ES modules). Use the current 4.x/5.x release, pinned. Optionally `@arcgis/map-components` for widgets.
- Import it **only** inside `apps/web/src/components/map/arcgis/`. Pages use `<MapView>` from `components/map/`.
- Lazy-load the map chunk (`React.lazy`), because the SDK is large. Other routes must not load it.
- Assets: set `esriConfig.assetsPath` to the copied `@arcgis/core/assets` (Vite static copy) or the Esri CDN path.
- Auth:
  - **Phase 1:** an ArcGIS **API key** (ArcGIS Location Platform or an ArcGIS Online developer credential) with basemap and elevation privileges. It is restricted by HTTP referrer to the Nexus domains, kept in Key Vault, and served to the SPA through `/v1/config`, never committed.
  - **If Innovo has an ArcGIS Online / Enterprise organisation:** use OAuth with the org (Entra SSO into ArcGIS) instead. This is an open question for Innovo IT; record the answer in the ADR.
- `esriConfig.apiKey = config.arcgis.apiKey` is set once in the adapter.

## 2. The wrapper (provider-neutral)
```ts
// apps/web/src/components/map/types.ts
export type MapMode = '2d' | 'satellite' | '3d';
export interface MapMarker {
  id: string;                 // asset or project id
  kind: 'project' | 'asset';
  lat: number; lng: number;
  icon: string;               // 'tower-crane' | 'hoist' | 'generator' | … | 'generic'
  colorKey: string;           // project state or display status: 'active' | 'running' | …
  label: string;
  pulse?: boolean;            // recent change → blink
  data?: Record<string, unknown>;
}
export interface MapViewProps {
  mode: MapMode;
  markers: MapMarker[];
  cluster?: boolean;
  focus?: { lat: number; lng: number; zoom: number } | { fitTo: 'markers' | 'boundary' };
  boundary?: GeoJSON.Polygon;           // project site outline if provided
  onMarkerClick?(m: MapMarker): void;
  onViewChange?(extent: { xmin: number; ymin: number; xmax: number; ymax: number; zoom: number }): void;
  overlays?: React.ReactNode;           // legend, mode switch, "coming later" buttons
}
```
- `MapView.tsx` picks the adapter (only `arcgis/` exists). If the provider ever changes, only `components/map/<provider>/` is replaced.
- Colours come from `styles/tokens.css`. ArcGIS renderers read them through a small token map, so they are never hard-coded in the adapter.

## 3. Portfolio map (top level)
- **View:** `MapView` (2D), basemap `arcgis/light-gray` or `arcgis/navigation`, centred on the UAE (≈ 24.4 N, 54.4 E, zoom 7). It is constrained to the UAE extent plus a margin.
- **Layer:** a client-side `FeatureLayer` built from `markers` (source graphics, `objectIdField`, fields: id, state, name).
- **Renderer:** `UniqueValueRenderer` on `state`:
  - `active` green
  - `central_store` blue
  - `finished` grey
  - `in_bid` yellow / light green
  - `unknown` neutral outline
- **Clustering:** `featureReduction: { type: 'cluster', clusterRadius: '60px' }`. The cluster popup shows a count by state.
- **Click:** the popup shows name, state, district and asset counts, with an "Open project" button that navigates to `/projects/:id`.
- **Legend:** a custom React legend (not the Esri widget) so it matches the design.

## 4. Project site map (Level 1)
- **Mode switch** (radio): 2D, Satellite or 3D.
  - **2D:** `MapView` + `arcgis/navigation` (or `arcgis/topographic`).
  - **Satellite:** `MapView` + `arcgis/imagery` (or `arcgis/imagery/standard` with labels).
  - **3D:** `SceneView` + `arcgis/imagery` basemap + `ground: 'world-elevation'`, plus a 3D buildings scene layer where available (Esri / OSM 3D buildings from Living Atlas). Keep the camera tilted (~60°) over the site.
  - When switching modes, keep the same layer data and move only the view. Destroy the old view to free memory.
- **Assets layer:** a client-side `FeatureLayer` with fields `id`, `assetType`, `status`, `name`.
  - Symbol: an icon per `assetType` (SVG from `assets/icons/asset-types/`, `PictureMarkerSymbol` or `CIMSymbol`).
  - Colour ring or background per `status`: running green, idle amber, maintenance red, off grey, unknown neutral. In 3D, use `IconSymbol3DLayer` with the same icons and `verticalOffset` callouts.
- **Blink or pulse:** when a live update changes an asset's status, add a short pulsing graphic (`GraphicsLayer` with an animated CIM symbol or a CSS-animated HTML overlay) for 10 s. Never blink everything all the time.
- **Live updates:** apply changes with `layer.applyEdits({ updateFeatures })` from `useLiveProject`. Do not rebuild the layer.
- **Site boundary:** if the source provides a boundary, draw it as a polygon `GraphicsLayer` and fit the view to it. Otherwise fit to the asset markers.
- **Click:** opens the asset side panel. The map does not navigate away.
- **Assets without coordinates:** listed in the side panel under "Not on map". They are never placed at a made-up position.

## 5. Performance targets
- 500 project markers and 5,000 asset markers stay smooth (client-side FeatureLayer + clustering).
- The map chunk is ≤ 2 MB gzipped and is lazy-loaded.
- Only one map view exists at a time. Views are destroyed on unmount (`view.destroy()`).
- Basemap sessions: one map load per page view. Do not re-create views on every re-render (keep them in refs).

## 6. Future (do not build now)
- **BIM:** in the same `SceneView`, add a `BuildingSceneLayer` (I3S from Revit/IFC, published to ArcGIS) or an `IntegratedMeshLayer` from drone surveys. Assets link to model elements through `core.zone.bim_ref` and `bim.element_link`. The alternative is an Autodesk APS viewer route; decide by ADR in phase 3.
- **Site plans:** a 2D georeferenced image overlay (`MediaLayer`) from Blob.
- **Moving assets:** a playback timeline from `telemetry.asset_location_history`.
- **Zones / geofences:** drawn from `core.zone.boundary`, but only as the source defines them.

## 7. Tests
- Unit-test the wrapper logic (marker mapping, colour keys) with the adapter mocked. **Don't** unit-test the ArcGIS internals.
- Playwright e2e uses a real map in one smoke test, with network stubs for tiles in the rest.
- Accessibility: keyboard focus to the project list as an alternative to the map. Every map action is also possible from the list.
