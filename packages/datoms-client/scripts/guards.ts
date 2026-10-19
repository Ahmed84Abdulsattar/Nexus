// Input checks for the live CLI. Kept apart from live.ts so tests can import them.

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
export const MAX_LATEST_IDS = 10;
export const MAX_BULK_IDS = 10;

/** Asset ids from the command line: letters, digits and "-" only, 1 to 64 characters. */
export function assertValidId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error('Invalid asset id (allowed: A-Z a-z 0-9 -, 1 to 64).');
  return id;
}

export function validateIds(ids: readonly string[], max: number): string[] {
  const unique = [...new Set(ids)];
  if (unique.length < 1 || unique.length > max) throw new Error(`Give 1 to ${max} ids.`);
  return unique.map(assertValidId);
}

/** Path of the per-asset latest call, with the id encoded. */
export function latestPath(id: string): string {
  return `/assets/${encodeURIComponent(assertValidId(id))}/data/latest`;
}

/**
 * Loads an env file without letting it change DATOMS_LIVE: the live gate is the shell's value
 * only (set on the command line), so a file can never switch it on.
 */
export function loadEnvFileKeepingLiveGate(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
  loader: (path: string) => void = (p) => process.loadEnvFile(p),
): void {
  const shell = env['DATOMS_LIVE'];
  loader(path);
  if (shell === undefined) delete env['DATOMS_LIVE'];
  else env['DATOMS_LIVE'] = shell;
}
