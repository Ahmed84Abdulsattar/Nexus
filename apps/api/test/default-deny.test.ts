import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/auth.js';
import { scanHandlers, unprotected } from './helpers/routes.js';

describe('default deny (docs/08 step 4, docs/10 Decorators)', () => {
  describe('the real application', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp();
    });
    afterAll(async () => {
      await t.app.close();
    });

    it('registers handlers and every one has exactly one of @RequirePermission / @AnySignedIn / @Public', () => {
      const handlers = scanHandlers(t.app);
      expect(handlers.length).toBeGreaterThan(0); // the scan must actually see routes
      const bad = unprotected(handlers).map((h) => `${h.controller}.${h.handler}`);
      expect(bad).toEqual([]);
    });

    it('allows @Public only on /health/*', () => {
      const publicHandlers = scanHandlers(t.app).filter((h) => h.policy.kind === 'public');
      expect(publicHandlers.map((h) => h.controller).sort()).toEqual(['HealthController']);
    });
  });

  describe('the scanner itself', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({ withTestRoutes: true });
    });
    afterAll(async () => {
      await t.app.close();
    });

    it('finds a handler that has no access decorator', () => {
      const bad = unprotected(scanHandlers(t.app)).map((h) => `${h.controller}.${h.handler}`);
      expect(bad).toEqual(['UndecoratedController.forgotten']);
    });

    it('refuses such a handler at runtime, even for a valid admin', async () => {
      t.directory.assignUserRole('aaaaaaaa-0000-4000-8000-000000000001', 'admin');
      const res = await t.get('/test-undecorated', await t.token());
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('leaked');
    });

    it('refuses such a handler without a token', async () => {
      const res = await t.get('/test-undecorated');
      expect(res.statusCode).toBe(403);
    });
  });
});
