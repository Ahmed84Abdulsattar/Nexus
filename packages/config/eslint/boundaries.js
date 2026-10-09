// Import-boundary rules (CLAUDE.md hard rules 2 and 7, docs/05, docs/sprints/S0.md S0-01).
//
//  - `@arcgis/*` only inside apps/web/src/components/map/arcgis/.
//  - `@nexus/datoms-client` only inside packages/connectors/datoms.
//  - `@nexus/connectors-*` only inside apps/worker (the connectors may use each other's core,
//    and packages/testing may use the core interface for its fake connector).
//
// Flat config applies the LAST matching block's `no-restricted-imports` option, so every
// group below lists its full set of bans.

const arcgis = {
  group: ['@arcgis/*'],
  message:
    '@arcgis/* may only be imported in apps/web/src/components/map/arcgis/. Pages use <MapView> from components/map/.',
};
const datomsClient = {
  group: ['@nexus/datoms-client', '@nexus/datoms-client/*'],
  message:
    'Only packages/connectors/datoms may import @nexus/datoms-client. The API, web and shared code never call DATOMS.',
};
const connectors = {
  group: ['@nexus/connectors-*'],
  message: 'Only apps/worker may import the source connectors.',
};
const connectorsDatoms = {
  group: ['@nexus/connectors-datoms', '@nexus/connectors-datoms/*'],
  message: 'Only apps/worker may import @nexus/connectors-datoms.',
};

const rule = (...patterns) => ['error', { patterns }];

const files = ['**/*.{ts,tsx,js,jsx,mjs,cjs}'];

export const boundaries = [
  // Default: nothing may import any of the three.
  { files, rules: { 'no-restricted-imports': rule(arcgis, datomsClient, connectors) } },
  // The one place ArcGIS is allowed.
  {
    files: ['apps/web/src/components/map/arcgis/**'],
    rules: { 'no-restricted-imports': rule(datomsClient, connectors) },
  },
  // The worker owns the connectors.
  { files: ['apps/worker/**'], rules: { 'no-restricted-imports': rule(arcgis, datomsClient) } },
  // The DATOMS connector wraps datoms-client and implements the core interface.
  {
    files: ['packages/connectors/datoms/**'],
    rules: { 'no-restricted-imports': rule(arcgis) },
  },
  // Core interface and test helpers may use the core package, nothing DATOMS-specific.
  {
    files: ['packages/connectors/core/**', 'packages/testing/**'],
    rules: { 'no-restricted-imports': rule(arcgis, datomsClient, connectorsDatoms) },
  },
];
