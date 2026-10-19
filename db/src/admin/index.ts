// Tools for migrations, seeds and checks. Used by the db scripts and the tests, never by the api or worker at runtime.
export { adminTarget, explainAdminError, runScript } from './cli.js';
export { checkSchema, diffLines, normalizeDump, type CheckResult } from './check.js';
export { runCodegen, TYPES_FILE } from './codegen.js';
export {
  applyRoles,
  bootstrapRoles,
  migrate,
  MIGRATOR_ROLE,
  type MigrateDirection,
  type MigrateOptions,
  type MigrateResult,
} from './migrate.js';
export { DB_ROOT, MIGRATIONS_DIR, ROLES_FILE, SCHEMA_FILE, SEEDS_DIR } from './paths.js';
export { findPgTool, pgDump, postgresEnvironment } from './pg-tools.js';
export { parseAppEnv, seed, SEEDS, type AppEnv, type SeedResult } from './seed.js';
