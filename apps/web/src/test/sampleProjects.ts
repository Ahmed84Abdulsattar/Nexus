import type { ProjectMapItem } from '@nexus/shared';

/**
 * TEST DATA ONLY. Ten generic sample projects for the MSW mock (S0-09). The names are not real
 * sites (CLAUDE.md hard rule 3); the points are spread over the UAE to exercise clustering and
 * the state tokens. This file is imported only by src/test/ and the dev-only mock worker, and the
 * production build checks that none of it is in dist/.
 */
export const SAMPLE_PROJECTS: ProjectMapItem[] = [
  {
    id: 'sample-01',
    name: 'Sample project 01',
    state: 'active',
    latitude: 24.45,
    longitude: 54.38,
  },
  { id: 'sample-02', name: 'Sample project 02', state: 'active', latitude: 25.2, longitude: 55.27 },
  { id: 'sample-03', name: 'Sample project 03', state: 'active', latitude: 25.35, longitude: 55.4 },
  {
    id: 'sample-04',
    name: 'Sample project 04',
    state: 'central_store',
    latitude: 25.41,
    longitude: 55.44,
  },
  {
    id: 'sample-05',
    name: 'Sample project 05',
    state: 'finished',
    latitude: 25.79,
    longitude: 55.95,
  },
  {
    id: 'sample-06',
    name: 'Sample project 06',
    state: 'in_bid',
    latitude: 25.12,
    longitude: 56.33,
  },
  {
    id: 'sample-07',
    name: 'Sample project 07',
    state: 'active',
    latitude: 24.21,
    longitude: 55.76,
  },
  {
    id: 'sample-08',
    name: 'Sample project 08',
    state: 'central_store',
    latitude: 25.56,
    longitude: 55.55,
  },
  {
    id: 'sample-09',
    name: 'Sample project 09',
    state: 'finished',
    latitude: 24.11,
    longitude: 52.73,
  },
  {
    id: 'sample-10',
    name: 'Sample project 10',
    state: 'unknown',
    latitude: 23.13,
    longitude: 53.77,
  },
];

/** State labels as the API would serve them in /v1/config enums. */
export const SAMPLE_STATE_LABELS: Record<string, string> = {
  active: 'Active',
  central_store: 'Central store',
  finished: 'Finished',
  in_bid: 'In bid',
  unknown: 'Unknown',
};
