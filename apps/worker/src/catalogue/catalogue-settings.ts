import type { CatalogueSettings } from '@nexus/connectors-core';
import type { Database } from '@nexus/db';
import { z } from 'zod';

/** `core.setting` keys the catalogue sync reads (docs/06 seed data). Never constants in code. */
const schema = z.object({
  'catalogue.retire_after_misses': z.number().int().min(1),
  'catalogue.retire_max_fraction': z.number().min(0).max(1),
});

/** Interval bounds (M2): 5 minutes to 24 hours. Anything else falls back to the default. */
const intervalSchema = z.number().int().min(5).max(1440);
export const DEFAULT_INTERVAL_MINUTES = 60;

export interface LoadedCatalogueSettings {
  intervalMs: number;
  retire: CatalogueSettings;
}

/**
 * Reads the settings fresh at each run, so an admin change applies to the next sync. A missing or
 * invalid value throws: the sync then fails closed (it does not retire anything on a guess).
 */
export async function loadCatalogueSettings(
  db: Database,
  onInvalidInterval?: (configured: unknown) => void,
): Promise<LoadedCatalogueSettings> {
  const rows = await db
    .selectFrom('core.setting')
    .select(['key', 'value'])
    .where('key', 'in', [...Object.keys(schema.shape), 'catalogue.interval_minutes'])
    .execute();
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const parsed = schema.safeParse(values);
  const interval = intervalSchema.safeParse(values['catalogue.interval_minutes']);
  if (!interval.success) onInvalidInterval?.(values['catalogue.interval_minutes']);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid catalogue settings in core.setting: ${problems.join('; ')}`);
  }
  return {
    intervalMs: (interval.success ? interval.data : DEFAULT_INTERVAL_MINUTES) * 60_000,
    retire: {
      retireAfterMisses: parsed.data['catalogue.retire_after_misses'],
      retireMaxFraction: parsed.data['catalogue.retire_max_fraction'],
    },
  };
}
