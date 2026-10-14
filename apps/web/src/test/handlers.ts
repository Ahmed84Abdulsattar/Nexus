import type { ConfigResponse, ProjectMapPage } from '@nexus/shared';
import { http, HttpResponse } from 'msw';
import { SAMPLE_PROJECTS, SAMPLE_STATE_LABELS } from './sampleProjects';

/**
 * The developer's own ArcGIS key for the local mock only (docs/sprints/S0.md section 5). It is read
 * in Vite dev mode and nowhere else; in a production build this file is not part of the bundle, and
 * the build fails if the variable is set. Empty means "not configured".
 */
function devKey(): string {
  return import.meta.env.DEV ? (import.meta.env.VITE_DEV_ARCGIS_API_KEY ?? '') : '';
}

export function configBody(apiKey: string): ConfigResponse {
  return {
    arcgis: { apiKey },
    enums: {
      projectStates: Object.entries(SAMPLE_STATE_LABELS).map(([key, label]) => ({ key, label })),
      displayStatuses: [],
    },
    featureFlags: { weather: false, manpower: false, materials: false, gallery: false },
  };
}

export const configHandler = (apiKey: () => string = devKey) =>
  http.get('*/v1/config', () => HttpResponse.json(configBody(apiKey())));

export const projectsHandler = (items = SAMPLE_PROJECTS) =>
  http.get('*/v1/projects', () =>
    HttpResponse.json({ items, nextCursor: null } satisfies ProjectMapPage),
  );

export const handlers = [configHandler(), projectsHandler()];
