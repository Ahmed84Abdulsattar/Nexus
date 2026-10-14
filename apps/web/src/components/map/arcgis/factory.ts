// The ONLY file (with ArcgisMap.tsx) that imports @arcgis/core (CLAUDE.md hard rule 7, docs/09).
// It is loaded lazily, so no other route pays for the SDK.
import '@arcgis/core/assets/esri/themes/light/main.css';
import esriConfig from '@arcgis/core/config';
import type EsriExtent from '@arcgis/core/geometry/Extent';
import type EsriFeatureLayer from '@arcgis/core/layers/FeatureLayer';
import type EsriMapView from '@arcgis/core/views/MapView';
import type EsriSceneView from '@arcgis/core/views/SceneView';
import { STATE_STATUS_TOKENS } from '../../../styles/tokens';
import { UAE_EXTENT, UAE_VIEW } from '../defaults';
import { readTokenColor } from '../colors';
import type { MapExtent, MapFocus, MapLayerSpec, MapMarker } from '../types';
import { diffMarkers, toFeatureSpec } from './features';
import { BASEMAP_BY_MODE, BUILDINGS_3D_URL, CLUSTER_RADIUS, GROUND_3D, TILT_3D } from './settings';
import type { MapSurface, SurfaceFactory } from './viewManager';

export interface SurfaceHandlers {
  onMarkerClick?: ((marker: MapMarker) => void) | undefined;
  onViewChange?: ((extent: MapExtent) => void) | undefined;
}

/** Sets the browser key once. It is never logged, put in a URL by us, or stored. */
export function configureArcgis(apiKey: string): void {
  esriConfig.apiKey = apiKey;
}

const ignoreAbort = (error: unknown) => {
  if (error instanceof Error && error.name === 'AbortError') return;
  console.warn('Map navigation failed', error instanceof Error ? error.name : 'unknown error');
};

/** Builds MapView (2D, satellite) or SceneView (3D). `getHandlers` is read at event time. */
export function createArcgisFactory(getHandlers: () => SurfaceHandlers): SurfaceFactory {
  return {
    async create(mode, container) {
      const is3d = mode === '3d';
      const [
        { default: EsriMap },
        { default: FeatureLayer },
        { default: Graphic },
        { default: Extent },
        reactiveUtils,
        webMercatorUtils,
      ] = await Promise.all([
        import('@arcgis/core/Map'),
        import('@arcgis/core/layers/FeatureLayer'),
        import('@arcgis/core/Graphic'),
        import('@arcgis/core/geometry/Extent'),
        import('@arcgis/core/core/reactiveUtils'),
        import('@arcgis/core/geometry/support/webMercatorUtils'),
      ]);

      // A fresh element per view, so destroying a view leaves the container clean.
      const element = document.createElement('div');
      element.style.cssText = 'width:100%;height:100%';
      container.appendChild(element);

      const map = new EsriMap(
        is3d
          ? { basemap: BASEMAP_BY_MODE[mode], ground: GROUND_3D }
          : { basemap: BASEMAP_BY_MODE[mode] },
      );

      let view: EsriMapView | EsriSceneView;
      if (is3d) {
        const [{ default: SceneView }, { default: SceneLayer }] = await Promise.all([
          import('@arcgis/core/views/SceneView'),
          import('@arcgis/core/layers/SceneLayer'),
        ]);
        map.add(new SceneLayer({ url: BUILDINGS_3D_URL, popupEnabled: false }));
        view = new SceneView({
          container: element,
          map,
          center: [UAE_VIEW.lng, UAE_VIEW.lat],
          zoom: UAE_VIEW.zoom,
          popupEnabled: false,
        });
        void view.when(() => goTo({ tilt: TILT_3D }, { animate: false })).catch(ignoreAbort);
      } else {
        const { default: MapView } = await import('@arcgis/core/views/MapView');
        view = new MapView({
          container: element,
          map,
          center: [UAE_VIEW.lng, UAE_VIEW.lat],
          zoom: UAE_VIEW.zoom,
          popupEnabled: false,
          constraints: {
            geometry: new Extent({ ...UAE_EXTENT, spatialReference: { wkid: 4326 } }),
          },
        });
      }

      // goTo targets differ between MapView and SceneView (tilt); one loose signature covers both.
      const goTo = (target: unknown, options?: unknown) =>
        (view as unknown as { goTo(t: unknown, o?: unknown): Promise<unknown> }).goTo(
          target,
          options,
        );

      // Colours come from tokens.css at creation time (docs/09 section 2).
      const tok = (token: string) => readTokenColor(token);
      const ring = tok('bg');
      const symbolFor = (token: string) => {
        const hollow = token === 'status-unknown';
        return {
          type: 'simple-marker' as const,
          // Shape also carries meaning, so colour is never the only cue: square = project state,
          // circle = asset status, hollow = unknown (docs/11 rule 4).
          style: token.startsWith('state-') ? ('square' as const) : ('circle' as const),
          size: 14,
          color: hollow ? [0, 0, 0, 0] : tok(token),
          outline: { color: hollow ? tok(token) : ring, width: hollow ? 3 : 2 },
        };
      };
      const renderer = {
        type: 'unique-value' as const,
        field: 'token',
        defaultSymbol: symbolFor('status-unknown'),
        uniqueValueInfos: STATE_STATUS_TOKENS.map((token) => ({
          value: token,
          symbol: symbolFor(token),
        })),
      };

      interface LayerState {
        layer: EsriFeatureLayer;
        markers: Map<string, MapMarker>;
        oids: Map<string, number>;
        nextOid: number;
        pending: Promise<unknown>;
      }
      const layers = new Map<string, LayerState>();
      const toGraphic = (marker: MapMarker, oid: number) => {
        const spec = toFeatureSpec(marker);
        return new Graphic({
          geometry: { type: 'point', latitude: spec.lat, longitude: spec.lng },
          attributes: { oid, ...spec.attributes },
        });
      };
      const featureReduction = (cluster: boolean) =>
        cluster && !is3d
          ? {
              type: 'cluster' as const,
              clusterRadius: CLUSTER_RADIUS,
              renderer: {
                type: 'simple' as const,
                symbol: {
                  type: 'simple-marker' as const,
                  color: tok('surface-raised'),
                  outline: { color: tok('border-strong'), width: 2 },
                },
                visualVariables: [
                  {
                    type: 'size' as const,
                    field: 'cluster_count',
                    stops: [
                      { value: 2, size: 22 },
                      { value: 100, size: 44 },
                    ],
                  },
                ],
              },
              labelingInfo: [
                {
                  deconflictionStrategy: 'none' as const,
                  labelExpressionInfo: { expression: "Text($feature.cluster_count, '#,###')" },
                  symbol: {
                    type: 'text' as const,
                    color: tok('fg'),
                    font: { size: 12, weight: 'bold' as const },
                  },
                  labelPlacement: 'center-center' as const,
                },
              ],
            }
          : null;

      const createLayer = (spec: MapLayerSpec): LayerState => {
        const layer = new FeatureLayer({
          id: spec.id,
          source: [],
          objectIdField: 'oid',
          geometryType: 'point',
          spatialReference: { wkid: 4326 },
          fields: [
            { name: 'oid', type: 'oid' },
            { name: 'id', type: 'string' },
            { name: 'kind', type: 'string' },
            { name: 'label', type: 'string' },
            { name: 'colorKey', type: 'string' },
            { name: 'icon', type: 'string' },
            { name: 'token', type: 'string' },
          ],
          renderer,
          // No callouts in 3D (ADR 0008); labels and clustering are 2D and satellite only.
          labelsVisible: !is3d,
          labelingInfo: is3d
            ? []
            : [
                {
                  labelExpressionInfo: { expression: '$feature.label' },
                  symbol: {
                    type: 'text',
                    color: tok('fg'),
                    haloColor: tok('bg'),
                    haloSize: 1.5,
                    font: { size: 11 },
                  },
                  labelPlacement: 'above-center',
                },
              ],
          featureReduction: featureReduction(spec.cluster),
          popupEnabled: false,
        });
        map.add(layer);
        return {
          layer,
          markers: new Map(),
          oids: new Map(),
          nextOid: 1,
          pending: Promise.resolve(),
        };
      };

      const syncLayer = async (state: LayerState, spec: MapLayerSpec) => {
        const { add, update, remove } = diffMarkers(state.markers, spec.markers);
        const addFeatures = add.map((m) => {
          const oid = state.nextOid++;
          state.oids.set(m.id, oid);
          return toGraphic(m, oid);
        });
        const updateFeatures = update.flatMap((m) => {
          const oid = state.oids.get(m.id);
          return oid === undefined ? [] : [toGraphic(m, oid)];
        });
        const deleteFeatures = remove.flatMap((id) => {
          const oid = state.oids.get(id);
          state.oids.delete(id);
          return oid === undefined ? [] : [{ objectId: oid }];
        });
        state.markers = new Map(spec.markers.map((m) => [m.id, m]));
        if (addFeatures.length + updateFeatures.length + deleteFeatures.length === 0) return;
        await state.layer.applyEdits({ addFeatures, updateFeatures, deleteFeatures });
      };

      let allMarkers = new Map<string, MapMarker>();
      let destroyed = false;

      const fitToMarkers = async () => {
        const graphics = (
          await Promise.all([...layers.values()].map((s) => s.layer.queryFeatures()))
        ).flatMap((r) => r.features);
        if (graphics.length === 0) return;
        await goTo(is3d ? { target: graphics, tilt: TILT_3D } : graphics);
      };

      const clickHandle = view.on('click', (event) => {
        const include = [...layers.values()].map((s) => s.layer);
        void view
          .hitTest(event, { include })
          .then((response) => {
            const hit = response.results.find((r) => r.type === 'graphic');
            if (hit?.type !== 'graphic') return;
            const graphic = hit.graphic;
            if (graphic.isAggregate) {
              // A cluster: zoom in instead of opening anything.
              return goTo({ target: graphic.geometry, zoom: (view.zoom ?? UAE_VIEW.zoom) + 2 });
            }
            const marker = allMarkers.get(String(graphic.attributes.id));
            if (marker) getHandlers().onMarkerClick?.(marker);
            return undefined;
          })
          .catch(ignoreAbort);
      });

      const watchHandle = reactiveUtils.watch(
        () => view.stationary,
        (stationary) => {
          const handler = getHandlers().onViewChange;
          const extent = view.extent;
          if (!stationary || !handler || !extent) return;
          const geographic = webMercatorUtils.webMercatorToGeographic(extent) as EsriExtent;
          handler({
            xmin: geographic.xmin,
            ymin: geographic.ymin,
            xmax: geographic.xmax,
            ymax: geographic.ymax,
            zoom: view.zoom,
          });
        },
      );

      const surface: MapSurface = {
        setLayers(specs) {
          allMarkers = new Map(specs.flatMap((s) => s.markers).map((m) => [m.id, m]));
          const wanted = new Set(specs.map((s) => s.id));
          for (const [id, state] of layers) {
            if (!wanted.has(id)) {
              map.remove(state.layer);
              state.layer.destroy();
              layers.delete(id);
            }
          }
          for (const spec of specs) {
            let state = layers.get(spec.id);
            if (!state) {
              state = createLayer(spec);
              layers.set(spec.id, state);
            }
            state.layer.featureReduction = featureReduction(spec.cluster) as never;
            state.pending = syncLayer(state, spec).catch(ignoreAbort);
          }
        },
        setFocus(focus: MapFocus | undefined) {
          if (!focus) return;
          const run = async () => {
            await view.when();
            if (destroyed) return;
            if ('fitTo' in focus) {
              await syncPending();
              await fitToMarkers();
            } else {
              await goTo({ center: [focus.lng, focus.lat], zoom: focus.zoom });
            }
          };
          void run().catch(ignoreAbort);
        },
        destroy() {
          destroyed = true;
          clickHandle.remove();
          watchHandle.remove();
          view.destroy();
          element.remove();
        },
      };
      // fitTo needs the latest edits applied before querying features.
      const syncPending = async () => {
        await Promise.all([...layers.values()].map((state) => state.pending));
      };
      return surface;
    },
  };
}
