// pnpm db:migrate [up | down [N|all] | redo] [--confirm-database=<name>]
//   up        apply every pending migration, then db/roles.sql (default)
//   down      revert the last migration (down 3 = three, down all = everything)
//   redo      down one, then up
// down and redo drop tables: they run freely only when APP_ENV=local and the database is on this machine. Elsewhere add
// --confirm-database=<name> with the exact database name of DATABASE_ADMIN_URL.
import { adminTarget, explainAdminError, runScript } from '../src/admin/cli.js';
import { migrate } from '../src/admin/migrate.js';

await runScript(async () => {
  const argv = process.argv.slice(2);
  const confirmDatabase = argv.find((a) => a.startsWith('--confirm-database='))?.slice('--confirm-database='.length);
  const [command = 'up', arg] = argv.filter((a) => !a.startsWith('--'));
  const target = adminTarget();
  const log = (message: string): void => console.log(message);
  try {
    if (command === 'up') {
      const { applied } = await migrate({ url: target.url, direction: 'up', log });
      console.log(applied.length > 0 ? `applied: ${applied.join(', ')}` : 'already up to date');
    } else if (command === 'down') {
      const count = arg === 'all' ? Infinity : arg === undefined ? 1 : Number(arg);
      if (!(count >= 1)) throw new Error(`down: expected a number or "all", got "${arg}"`);
      const { applied } = await migrate({ url: target.url, direction: 'down', count, confirmDatabase, log });
      console.log(applied.length > 0 ? `reverted: ${applied.join(', ')}` : 'nothing to revert');
    } else if (command === 'redo') {
      await migrate({ url: target.url, direction: 'down', count: 1, confirmDatabase, log });
      await migrate({ url: target.url, direction: 'up', log });
      console.log('redone');
    } else {
      throw new Error(`unknown command "${command}". Use: up | down [N|all] | redo`);
    }
  } catch (error) {
    explainAdminError(error, target);
  }
});
