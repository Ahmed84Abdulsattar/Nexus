import { describe, expect, it } from 'vitest';
import {
  cursorPageQuerySchema,
  healthLiveSchema,
  problemDetailsSchema,
  syncRunDetailsSchema,
} from '../src/index.js';

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

describe('syncRunDetailsSchema (integration.sync_run.details)', () => {
  const ok = {
    job: 'catalogue_sync',
    seen: 22,
    total: 22,
    complete: true,
    inserted: 22,
    updated: 0,
    unchanged: 0,
    reappeared: 0,
    missed: 0,
    retired: 0,
    linkTodos: 22,
    warnings: [],
  };
  it('accepts a catalogue run with typed warnings', () => {
    expect(syncRunDetailsSchema.safeParse(ok).success).toBe(true);
    const warned = {
      ...ok,
      warnings: [
        { code: 'incomplete_walk', seen: 20, total: 22 },
        { code: 'retire_blocked', wouldRetire: 3, active: 22, fraction: 0.136, maxFraction: 0.05 },
      ],
    };
    expect(syncRunDetailsSchema.parse(warned).job).toBe('catalogue_sync');
  });
  it('rejects unknown jobs and unknown warning codes', () => {
    expect(syncRunDetailsSchema.safeParse({ ...ok, job: 'nope' }).success).toBe(false);
    expect(syncRunDetailsSchema.safeParse({ ...ok, warnings: [{ code: 'made_up' }] }).success).toBe(
      false,
    );
  });
});
