import { z } from 'zod';

/** One enum entry served by /v1/config. Labels come from the API, never from the web app. */
const enumEntrySchema = z.object({ key: z.string().min(1), label: z.string().min(1) });

/**
 * GET /v1/config (docs/10, @AnySignedIn): the ArcGIS key and settings, the enums (project states,
 * display statuses) and the feature flags (docs/11 "coming later" slots).
 *
 * `arcgis.apiKey` is the referrer-restricted browser key (docs/09 section 1). An empty string means
 * "no key configured": the web app then shows "Map key not configured" and never falls back to a
 * built-in key. The key must never be logged, put in a URL or written to storage.
 */
export const configResponseSchema = z.object({
  arcgis: z.object({ apiKey: z.string() }),
  enums: z.object({
    projectStates: z.array(enumEntrySchema),
    displayStatuses: z.array(enumEntrySchema),
  }),
  featureFlags: z.record(z.string(), z.boolean()),
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;
