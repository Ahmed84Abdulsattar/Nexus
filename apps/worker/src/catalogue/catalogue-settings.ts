import type { CatalogueSettings } from '@nexus/connectors-core';
import type { Database } from '@nexus/db';
import { z } from 'zod';

/** `core.setting` keys the catalogue sync reads (docs/06 seed data). Never constants in code. */
const schema = z.object({
  'catalogue.interval_minutes': z.number().positive(),
  'catalogue.retire_after_misses': z.number().int().min(1),
  'catalogue.retire_max_fraction': z.number().min(0).max(1),
});

export interface LoadedCatalogueSettings {
  intervalMs: number;
  retire: CatalogueSettings;
}

/**
 * Reads the settings fresh at each run, so an admin change applies to the next sync. A missing or
 * invalid value throws: the sync then fails closed (it does not retire anything on a guess).
 */
export async function loadCatalogueSettings(db: Database): Promise<LoadedCatalogueSettings> {
  const rows = await db
    .selectFrom('core.setting')
    .select(['key', 'value'])
    .where('key', 'in', Object.keys(schema.shape))
    .execute();
  const parsed = schema.safeParse(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid catalogue settings in core.setting: ${problems.join('; ')}`);
  }
  return {
    intervalMs: parsed.data['catalogue.interval_minutes'] * 60_000,
    retire: {
      retireAfterMisses: parsed.data['catalogue.retire_after_misses'],
      retireMaxFraction: parsed.data['catalogue.retire_max_fraction'],
    },
  };
}
