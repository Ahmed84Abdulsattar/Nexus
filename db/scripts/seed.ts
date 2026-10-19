// pnpm db:seed
// Runs the seeds that belong to APP_ENV (see SEEDS in src/admin/seed.ts):
//   every environment  datoms-parameters.sql
//   local and dev      dev-roles.sql
//   local only         dev-login-roles.sql (passwordless nexus_api_local / nexus_worker_local)
import { adminTarget, explainAdminError, runScript } from '../src/admin/cli.js';
import { parseAppEnv, seed } from '../src/admin/seed.js';

await runScript(async () => {
  const appEnv = parseAppEnv(process.env['APP_ENV']);
  const target = adminTarget();
  try {
    const { ran, skipped } = await seed({
      url: target.url,
      appEnv,
      log: (m) => console.log(m),
    });
    console.log(`seeded: ${ran.join(', ')}${skipped.length > 0 ? `; skipped: ${skipped.join(', ')}` : ''}`);
  } catch (error) {
    explainAdminError(error, target);
  }
});
