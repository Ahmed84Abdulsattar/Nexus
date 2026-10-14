# db: the Nexus database

PostgreSQL 16, native partitions and Nexus rollup tables, one extension (`pg_trgm`). Design and rules: `docs/06-database.md`. This folder is also the workspace package `@nexus/db` (migration runner, seeds, schema check, typed Kysely access, test databases).

| Path | What |
|---|---|
| `schema.sql` | Reference schema: the **target state**. Every migration run must end here. |
| `migrations/NNNN_name.sql` | node-pg-migrate SQL files with `-- Up Migration` and `-- Down Migration`. |
| `roles.sql` | Roles and grants (least privilege). Applied by `pnpm db:migrate` after every run. |
| `seeds/` | `datoms-parameters.sql` (every env), `dev-roles.sql` (local, dev), `dev-login-roles.sql` (local only), `scale-100-sites.ts` (benchmark). |
| `bench/` | The main-screen queries (`screens.ts`) and how to run the benchmark. |
| `src/` | `@nexus/db`: `urls.ts` (which URL a process uses), `kysely.ts` (`createDatabase`), `types.ts` (**generated**), `admin/` (migrate, seed, check), `testing.ts` (test databases). |
| `scripts/` | The entry points behind the `pnpm db:*` commands. |

## Commands (from the repo root)
| Command | Does |
|---|---|
| `pnpm db:migrate` | Applies pending migrations as the role `nexus_migrator`, then `roles.sql`. `pnpm db:migrate down` reverts one (`down 3`, `down all`), `redo` = down + up. `down` and `redo` drop tables, so outside `APP_ENV=local` they need `--confirm-database=<name>`. |
| `pnpm db:seed` | Runs the seeds that belong to `APP_ENV`. Safe to repeat. |
| `pnpm db:check` | Applies all migrations to one empty database, loads `schema.sql` into another, and fails if `pg_dump --schema-only`, the reference data or `src/types.ts` differ. Needs `pg_dump` (see below). |
| `pnpm db:seed:scale` | Loads 100 sites / 5,000 assets / 7 days of packets into a **benchmark database** and prints sizes and screen timings (`bench/`). |
| `pnpm --filter @nexus/db codegen` | Regenerates `src/types.ts` from the migrated database in `DATABASE_ADMIN_URL`. |

Connection strings (see `docs/04-tech-stack.md`): `DATABASE_ADMIN_URL` for these commands, `DATABASE_URL` for the API and `WORKER_DATABASE_URL` for the worker. When `APP_ENV=local`, an unset `DATABASE_ADMIN_URL` or `WORKER_DATABASE_URL` falls back to `DATABASE_URL`; in dev and prod there is no fallback, and all three URLs must use TLS (`sslmode=verify-full`). `dev-login-roles.sql` needs exactly `nexus.app_env = local` (the runner sets it from `APP_ENV`; unset is refused) and a local database host.

## First run on a new machine
```
scripts/pg-local.ps1 start            # or: docker compose up -d
# .env:  APP_ENV=local, DATABASE_ADMIN_URL, DATABASE_URL, WORKER_DATABASE_URL  (docs/04)
pnpm db:migrate
pnpm db:seed
```
`pnpm db:seed` also creates the passwordless local users `nexus_api_local` and `nexus_worker_local` that `DATABASE_URL` and `WORKER_DATABASE_URL` use, so run it before starting the API and worker.

`pnpm db:check` needs `pg_dump` 16. It is found through `PG_DUMP` (full path), `NEXUS_PG_BIN`, the portable install of `scripts/pg-local.ps1`, then `PATH`.

## Writing a migration
1. Add `migrations/000N_name.sql` with `-- Up Migration` and a working `-- Down Migration`. Never edit a merged migration.
2. Update `schema.sql` to the same end state **in the same PR**, and `roles.sql` if a new table needs a grant.
3. Run `pnpm db:migrate`, then `pnpm --filter @nexus/db codegen` (commit `src/types.ts`), then `pnpm db:check`.
4. Hot tables (`telemetry.*`, `events.*`): add columns nullable first. Build indexes `CONCURRENTLY`. A `CONCURRENTLY` statement cannot run inside a transaction, and `.sql` migrations always run inside one, so write that migration as a `.js` file that calls `pgm.noTransaction()` (node-pg-migrate supports mixing both kinds).
5. Telemetry or event change: run the benchmark and put the timing table in the PR. A query over its N-04 target blocks the merge. An index is added only with `EXPLAIN ANALYZE` evidence in the PR.
6. Every query on a partitioned table needs a time filter.

## Tests that use PostgreSQL
They read `TEST_DATABASE_ADMIN_URL` (for example `postgres://nexus@localhost:5432/postgres`); each test file creates and drops its own database. When it is unset they are skipped with a warning. CI sets it for a `postgres:16` service.

## Roles
`nexus_migrator` owns every table and function and runs migrations and seeds. `nexus_api` and `nexus_worker` have only the grants in `roles.sql`. The partition functions `core.create_range_partitions` and `core.drop_partitions_before` are SECURITY DEFINER (owned by `nexus_migrator`, search_path pinned, only Nexus partitioned tables, executable by `nexus_worker` only).
