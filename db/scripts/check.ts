// pnpm db:check
// Applies every migration to an empty database, loads db/schema.sql into another, and fails if they
// differ (structure, reference data) or if db/src/types.ts is stale. Both databases are dropped after.
import { checkSchema } from '../src/admin/check.js';
import { adminTarget, explainAdminError, runScript } from '../src/admin/cli.js';

await runScript(async () => {
  const target = adminTarget();
  let result;
  try {
    result = await checkSchema({ adminUrl: target.url, log: (m) => console.log(m) });
  } catch (error) {
    explainAdminError(error, target);
  }
  if (!result.ok) {
    console.error('\ndb:check FAILED');
    for (const p of result.problems) console.error(p);
    process.exitCode = 1;
    return;
  }
  console.log('db:check passed: migrations, db/schema.sql and db/src/types.ts agree');
});
