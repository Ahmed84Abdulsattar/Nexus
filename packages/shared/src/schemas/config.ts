import { z } from 'zod';

/** One enum entry served by /v1/config. Labels come from the API, never from the web app. */
const enumEntrySchema = z.object({ key: z.string().min(1), label: z.string().min(1) });

/** A WGS84 (EPSG:4326) bounding box in degrees. */
const extentSchema = z.object({
  xmin: z.number().min(-180).max(180),
  ymin: z.number().min(-90).max(90),
  xmax: z.number().min(-180).max(180),
  ymax: z.number().min(-90).max(90),
});

/**
 * GET /v1/config (docs/10, @AnySignedIn): the ArcGIS key and settings, the enums (project states,
 * display statuses) and the feature flags (docs/11 "coming later" slots).
 *
 * `arcgis.apiKey` is the referrer-restricted browser key (docs/09 section 1). An empty string means
 * "no key configured": the web app then shows "Map key not configured" and never falls back to a
 * built-in key. The key must never be logged, put in a URL or written to storage. It is the only
 * credential this response may ever carry.
 *
 * `arcgis.basemaps` and `arcgis.extent` are additions to the S0-09 shape (additive: a reader that
 * only knows `apiKey` keeps working because zod strips unknown keys).
 */
export const configResponseSchema = z.object({
  arcgis: z.object({
    apiKey: z.string(),
    /** ArcGIS basemap style ids (docs/09 sections 3 and 4). */
    basemaps: z.object({
      map2d: z.string().min(1),
      satellite: z.string().min(1),
      scene3d: z.string().min(1),
    }),
    /** The UAE extent plus a margin the map is constrained to, and the first view (docs/09 section 3). */
    extent: extentSchema,
    initialView: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      zoom: z.number().min(0).max(24),
    }),
  }),
  enums: z.object({
    projectStates: z.array(enumEntrySchema),
    displayStatuses: z.array(enumEntrySchema),
  }),
  featureFlags: z.record(z.string(), z.boolean()),
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;
