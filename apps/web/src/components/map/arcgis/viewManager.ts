import type { MapFocus, MapLayerSpec, MapMode } from '../types';

/** One live map view (2D MapView or 3D SceneView) behind the adapter. */
export interface MapSurface {
  setLayers(layers: MapLayerSpec[]): void;
  setFocus(focus: MapFocus | undefined): void;
  /** Frees the view, its layers and its DOM. Called exactly once. */
  destroy(): void;
}

/** Creates a surface for a mode. The real implementation is `factory.ts`; tests inject a fake. */
export interface SurfaceFactory {
  /** `isStale()` turns true once a newer request or `destroy()` replaced this one. */
  create(mode: MapMode, container: HTMLElement, isStale?: () => boolean): Promise<MapSurface>;
}

/**
 * Keeps exactly one view alive (docs/09 section 5). On a mode switch the old view is destroyed
 * before the new one is created, and the new view gets the same layer data. A creation that
 * finishes after a newer request, or after `destroy()`, is destroyed straight away.
 */
export class ViewManager {
  private surface: MapSurface | undefined;
  private currentMode: MapMode | undefined;
  private requestId = 0;
  private layers: MapLayerSpec[] = [];
  private focus: MapFocus | undefined;
  private destroyed = false;

  constructor(
    private readonly factory: SurfaceFactory,
    private readonly container: HTMLElement,
  ) {}

  get mode(): MapMode | undefined {
    return this.currentMode;
  }

  async setMode(mode: MapMode): Promise<void> {
    if (this.destroyed || mode === this.currentMode) return;
    const request = ++this.requestId;
    this.surface?.destroy();
    this.surface = undefined;
    this.currentMode = mode;
    const surface = await this.factory.create(
      mode,
      this.container,
      () => this.destroyed || request !== this.requestId,
    );
    if (this.destroyed || request !== this.requestId) {
      surface.destroy();
      return;
    }
    this.surface = surface;
    surface.setLayers(this.layers);
    surface.setFocus(this.focus);
  }

  setLayers(layers: MapLayerSpec[]): void {
    this.layers = layers;
    this.surface?.setLayers(layers);
  }

  setFocus(focus: MapFocus | undefined): void {
    this.focus = focus;
    this.surface?.setFocus(focus);
  }

  destroy(): void {
    this.destroyed = true;
    this.requestId++;
    this.surface?.destroy();
    this.surface = undefined;
    this.currentMode = undefined;
  }
}
