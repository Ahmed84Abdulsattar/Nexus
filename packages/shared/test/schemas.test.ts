import { describe, expect, it } from 'vitest';
import { cursorPageQuerySchema, healthLiveSchema, problemDetailsSchema } from '../src/index.js';

describe('problemDetailsSchema', () => {
  it('accepts the documented shape and rejects non-error statuses', () => {
    const ok = { type: 'about:blank', title: 'Not Found', status: 404, detail: 'x' };
    expect(problemDetailsSchema.safeParse(ok).success).toBe(true);
    expect(problemDetailsSchema.safeParse({ ...ok, status: 200 }).success).toBe(false);
    const withErrors = { ...ok, errors: [{ path: 'a', message: 'b' }] };
    expect(problemDetailsSchema.safeParse(withErrors).success).toBe(true);
  });
});

describe('cursorPageQuerySchema (docs/10 paging)', () => {
  it('defaults to 50 and caps at 500', () => {
    expect(cursorPageQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(cursorPageQuerySchema.parse({ limit: '500' }).limit).toBe(500);
    expect(cursorPageQuerySchema.safeParse({ limit: '501' }).success).toBe(false);
  });
});

it('healthLiveSchema only accepts status ok', () => {
  expect(healthLiveSchema.safeParse({ status: 'ok' }).success).toBe(true);
  expect(healthLiveSchema.safeParse({ status: 'down' }).success).toBe(false);
});
