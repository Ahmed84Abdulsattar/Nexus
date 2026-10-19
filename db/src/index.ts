// The runtime surface used by apps/api and apps/worker: connection strings, the typed query
// builder and the generated table types. Migrations, seeds and checks are in ./admin (scripts only).
export {
  DATABASE_URL_VARIABLE,
  DatabaseConfigError,
  describeDatabaseUrl,
  requireTlsUnlessLocal,
  resolveDatabaseUrl,
  type DatabaseRole,
  type ResolvedDatabaseUrl,
} from './urls.js';
export { createDatabase, type CreateDatabaseOptions, type Database } from './kysely.js';
export type * from './types.js';
