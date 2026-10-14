/* global __ENV, open */
// S5-04 · k6 load test for the Nexus API: 1,000 virtual users on the docs/10 user journey.
// Journey: portfolio -> project page -> equipment / energy -> asset panel -> trends.
// How to run and record results: tests/load/README.md. Targets: docs/12 section 3.
//
// Env (never hard-code):
//   K6_API_BASE_URL   API origin, no trailing slash (default http://localhost:3000)
//   K6_BEARER_TOKEN   Entra access token (AUTH_MODE=dev token locally once it exists). Optional for /health.
//   K6_IDS_FILE       JSON { "projectIds": [...], "assetIds": [...] } (used when the list endpoints are disabled)
//   K6_ENABLE         comma list of endpoint names to enable on top of the defaults, or "all"
//   K6_PEAK_VUS       peak virtual users (default 1000)
//   K6_RAMP / K6_HOLD / K6_RAMPDOWN  ramp-up, hold and ramp-down durations (default 5m / 10m / 1m)
//   K6_SETUP_PROJECTS how many projects setup() reads assets from (default 10)
//   K6_THINK_MIN / K6_THINK_MAX  think time seconds between steps (default 3 / 8)
//   K6_ENERGY_METRIC  metric key for the energy trend call (only used when that endpoint is enabled)
//   K6_HISTORY_PARAMETER  parameter key for the asset history call (only used when that endpoint is enabled)
// A call whose ids or keys are missing is skipped, setup() warns about it, and the per-kind
// `count>0` threshold makes the run fail if a whole kind of request was never sent.
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const BASE_URL = (__ENV.K6_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = __ENV.K6_BEARER_TOKEN || '';
const PEAK_VUS = Number(__ENV.K6_PEAK_VUS || 1000);
const THINK_MIN = Number(__ENV.K6_THINK_MIN || 3);
const THINK_MAX = Number(__ENV.K6_THINK_MAX || 8);
const ENERGY_METRIC = __ENV.K6_ENERGY_METRIC || '';
const HISTORY_PARAMETER = __ENV.K6_HISTORY_PARAMETER || '';
const SETUP_PROJECTS = Number(__ENV.K6_SETUP_PROJECTS || 10);

// Targets (kind -> p95 in ms). Sources:
//   latest: docs/02 N-04, API p95 < 300 ms for latest-value screens
//   search: PENDING CONFIRMATION. No doc backs "search < 300 ms"; the value is borrowed from the
//           latest-value target. The user decides (see tests/load/README.md).
//   page:   backlog S8-01, "pages load in under 2 seconds" at target load
//   chart:  docs/02 N-04 and backlog S4 acceptance, chart queries under 1 s
const P95_MS = { latest: 300, search: 300, page: 2000, chart: 1000 };

// Endpoint list from docs/10. `enabled: false` means the endpoint is not built yet; flip it when it lands
// (or run once with K6_ENABLE=name1,name2 / K6_ENABLE=all). Paths use {projectId} / {assetId}.
const ENDPOINTS = {
  healthLive: { path: '/health/live', kind: 'latest', enabled: true },
  projects: { path: '/v1/projects?limit=100', kind: 'page', enabled: false },
  projectsSummary: { path: '/v1/projects/summary', kind: 'latest', enabled: false },
  projectsSearch: { path: '/v1/projects?q=site', kind: 'search', enabled: false },
  project: { path: '/v1/projects/{projectId}', kind: 'latest', enabled: false },
  equipmentSummary: {
    path: '/v1/projects/{projectId}/equipment/summary',
    kind: 'latest',
    enabled: false,
  },
  energySummary: {
    path: '/v1/projects/{projectId}/energy/summary',
    kind: 'latest',
    enabled: false,
  },
  assets: { path: '/v1/projects/{projectId}/assets?limit=100', kind: 'page', enabled: false },
  energyAssets: { path: '/v1/projects/{projectId}/energy/assets', kind: 'page', enabled: false },
  asset: { path: '/v1/assets/{assetId}', kind: 'latest', enabled: false },
  assetHistory30d: {
    path: '/v1/assets/{assetId}/history?parameter={parameter}&from={from30d}&to={to}&resolution=1h',
    kind: 'chart',
    enabled: false,
  },
  energyTrends30d: {
    path: '/v1/projects/{projectId}/energy/trends?metric={metric}&from={from30d}&to={to}&resolution=1h',
    kind: 'chart',
    enabled: false,
  },
};

// The journey: ordered steps, each a list of endpoint names fired together (a page load).
const JOURNEY = [
  { name: 'portfolio', calls: ['healthLive', 'projects', 'projectsSummary'] },
  { name: 'search', calls: ['projectsSearch'] },
  { name: 'project page', calls: ['project', 'equipmentSummary', 'energySummary'] },
  { name: 'equipment', calls: ['assets'] },
  { name: 'asset panel', calls: ['asset'] },
  { name: 'energy page', calls: ['energyAssets', 'energyTrends30d'] },
  { name: 'trends', calls: ['assetHistory30d'] },
];

const enableList = (__ENV.K6_ENABLE || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
function isEnabled(name) {
  return ENDPOINTS[name].enabled || enableList.includes('all') || enableList.includes(name);
}

// Optional ids file (init context). Synthetic ids only; see tests/load/README.md.
const fileIds = new SharedArray('ids', () => {
  if (!__ENV.K6_IDS_FILE) return [];
  return [JSON.parse(open(__ENV.K6_IDS_FILE))];
});

// A threshold on an empty sub-metric passes. For every enabled kind also require at least one request.
const thresholds = {
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
  'http_req_duration{kind:latest}': [`p(95)<${P95_MS.latest}`],
  'http_req_duration{kind:search}': [`p(95)<${P95_MS.search}`],
  'http_req_duration{kind:page}': [`p(95)<${P95_MS.page}`],
  'http_req_duration{kind:chart}': [`p(95)<${P95_MS.chart}`],
};
for (const kind of new Set(
  Object.keys(ENDPOINTS)
    .filter(isEnabled)
    .map((n) => ENDPOINTS[n].kind),
)) {
  thresholds[`http_reqs{kind:${kind}}`] = ['count>0'];
}

export const options = {
  scenarios: {
    journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.K6_RAMP || '5m', target: PEAK_VUS },
        { duration: __ENV.K6_HOLD || '10m', target: PEAK_VUS },
        { duration: __ENV.K6_RAMPDOWN || '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

function pick(list) {
  return list.length ? list[Math.floor(Math.random() * list.length)] : undefined;
}

function get(path, tags) {
  return http.get(`${BASE_URL}${path}`, { headers, tags });
}

function listItems(res) {
  if (res.status !== 200) return [];
  const body = res.json();
  return Array.isArray(body) ? body : body.items || body.data || [];
}

// Runs once. Ids come from the ids file, or from the API when the list endpoints are enabled.
// assetsByProject keeps each asset with the project it belongs to, so a journey never mixes them.
// The ids file may be { projectIds, assetIds } (flat) or { projectIds, assetsByProject: { id: [ids] } }.
export function setup() {
  const file = fileIds.length ? fileIds[0] : {};
  const ids = {
    projectIds: file.projectIds || [],
    assetIds: file.assetIds || [],
    assetsByProject: file.assetsByProject || {},
  };
  if (isEnabled('projects')) {
    const res = get(ENDPOINTS.projects.path, { kind: 'setup', name: 'setup projects' });
    ids.projectIds = listItems(res)
      .map((p) => p.id)
      .filter(Boolean);
  }
  if (isEnabled('assets') && ids.projectIds.length && !Object.keys(ids.assetsByProject).length) {
    for (const projectId of ids.projectIds.slice(0, SETUP_PROJECTS)) {
      const res = get(ENDPOINTS.assets.path.replace('{projectId}', projectId), {
        kind: 'setup',
        name: 'setup assets',
      });
      const found = listItems(res)
        .map((a) => a.id)
        .filter(Boolean);
      if (found.length) ids.assetsByProject[projectId] = found;
    }
  }
  const haveAssets = ids.assetIds.length > 0 || Object.keys(ids.assetsByProject).length > 0;
  const missing = {
    projectId: ids.projectIds.length === 0,
    assetId: !haveAssets,
    parameter: HISTORY_PARAMETER === '',
    metric: ENERGY_METRIC === '',
  };
  for (const name of Object.keys(ENDPOINTS).filter(isEnabled)) {
    const path = ENDPOINTS[name].path;
    const gaps = Object.keys(missing).filter((k) => missing[k] && path.includes(`{${k}}`));
    if (gaps.length) {
      console.warn(
        `WARNING: endpoint "${name}" is enabled but has no ${gaps.join(', ')}; its calls will be skipped.`,
      );
    }
  }
  return ids;
}

function resolve(path, ctx) {
  return path
    .replace('{projectId}', ctx.projectId || '')
    .replace('{assetId}', ctx.assetId || '')
    .replace('{parameter}', encodeURIComponent(HISTORY_PARAMETER))
    .replace('{metric}', encodeURIComponent(ENERGY_METRIC))
    .replace('{from30d}', encodeURIComponent(ctx.from30d))
    .replace('{to}', encodeURIComponent(ctx.to));
}

export default function (ids) {
  const now = new Date();
  const projectId = pick(ids.projectIds);
  // An asset of the chosen project when the project is known; the flat list otherwise.
  const ctx = {
    projectId,
    assetId: pick((projectId && ids.assetsByProject[projectId]) || ids.assetIds),
    to: now.toISOString(),
    from30d: new Date(now.getTime() - 30 * 86400000).toISOString(),
  };

  for (const step of JOURNEY) {
    const calls = step.calls.filter((name) => {
      if (!isEnabled(name)) return false;
      const needsProject = ENDPOINTS[name].path.includes('{projectId}');
      const needsAsset = ENDPOINTS[name].path.includes('{assetId}');
      const needsParameter = ENDPOINTS[name].path.includes('{parameter}');
      const needsMetric = ENDPOINTS[name].path.includes('{metric}');
      return !(
        (needsProject && !ctx.projectId) ||
        (needsAsset && !ctx.assetId) ||
        (needsParameter && !HISTORY_PARAMETER) ||
        (needsMetric && !ENERGY_METRIC)
      );
    });
    if (calls.length) {
      group(step.name, () => {
        const responses = http.batch(
          calls.map((name) => [
            'GET',
            `${BASE_URL}${resolve(ENDPOINTS[name].path, ctx)}`,
            null,
            { headers, tags: { kind: ENDPOINTS[name].kind, name: ENDPOINTS[name].path } },
          ]),
        );
        responses.forEach((res, i) => {
          check(res, { [`${calls[i]} status 200`]: (r) => r.status === 200 });
        });
      });
    }
    sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
  }
}
