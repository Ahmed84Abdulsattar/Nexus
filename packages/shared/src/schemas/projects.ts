import { z } from 'zod';
import { pageSchema } from '../paging.js';

/**
 * The minimal project list item the portfolio map needs (S0-09). A project without coordinates has
 * `latitude` and `longitude` null: it is listed but never placed on the map. The full contract is
 * defined by the API in S1-04 and replaces this.
 */
export const projectMapItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Project state key from the API (for example `active`); coloured from the state tokens. */
  state: z.string().min(1),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
});
export type ProjectMapItem = z.infer<typeof projectMapItemSchema>;

export const projectMapPageSchema = pageSchema(projectMapItemSchema);
export type ProjectMapPage = z.infer<typeof projectMapPageSchema>;
