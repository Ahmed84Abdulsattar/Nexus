import { z } from 'zod';

/** docs/10 "Paging": cursor based, default 50, maximum 500. */
export const MAX_PAGE_LIMIT = 500;
export const DEFAULT_PAGE_LIMIT = 50;

/** Query part of every list endpoint: `?limit=50&cursor=<opaque>`. */
export const cursorPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().min(1).optional().describe('Opaque; copy `nextCursor` from the last page.'),
});
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

/** Response envelope of every list endpoint: `{ items, nextCursor }`. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
