import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/auth.js';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.app.close();
});

it('GET /health/live answers 200 without a token (@Public)', async () => {
  const res = await t.get('/health/live');
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok' });
});
