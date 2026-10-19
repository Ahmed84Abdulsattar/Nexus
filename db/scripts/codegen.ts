// pnpm --filter @nexus/db codegen
// Regenerates db/src/types.ts (typed tables for Kysely) from the database in DATABASE_ADMIN_URL,
// which must already be migrated (pnpm db:migrate). Commit the result with the migration.
import { adminTarget, runScript } from '../src/admin/cli.js';
import { runCodegen } from '../src/admin/codegen.js';

await runScript(async () => {
  const target = adminTarget();
  const { stdout } = await runCodegen({ url: target.url });
  console.log(stdout.trim());
});
