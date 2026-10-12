import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/auth.js';
import { classLevelAccess, scanHandlers, unprotected } from './helpers/routes.js';

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
      const bad = unprotected(handlers).map((h) => `${h.path} (${h.controller}.${h.handler})`);
      expect(bad).toEqual([]);
    });

    it('has no class-level access metadata anywhere (decorators are per method)', () => {
      expect(classLevelAccess(t.app)).toEqual([]);
    });

    it('finds the known routes by path', () => {
      const paths = scanHandlers(t.app).map((h) => h.path);
      expect(paths).toContain('/health/live');
    });

    it('allows @Public only on /health/*', () => {
      const publicHandlers = scanHandlers(t.app).filter((h) => h.policy.kind === 'public');
      expect(publicHandlers.map((h) => h.path).sort()).toEqual(['/health/live']);
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

    it('finds handlers without a valid access decorator, by path', () => {
      const bad = unprotected(scanHandlers(t.app))
        .map((h) => h.path)
        .sort();
      expect(bad).toEqual(['/test-class-level', '/test-class-plus-method', '/test-undecorated']);
    });

    it('reports class-level access metadata', () => {
      expect(classLevelAccess(t.app).sort()).toEqual([
        'ClassLevelController',
        'ClassPlusMethodController',
      ]);
    });

    it.each(['/test-class-level', '/test-class-plus-method'])(
      'refuses %s at runtime, with and without a token',
      async (url) => {
        expect((await t.get('/v1' + url)).statusCode).toBe(403);
        const res = await t.get('/v1' + url, await t.token());
        expect(res.statusCode).toBe(403);
        expect(res.body).not.toContain('leaked');
      },
    );

    it('refuses such a handler at runtime, even for a valid admin', async () => {
      t.directory.assignUserRole('aaaaaaaa-0000-4000-8000-000000000001', 'admin');
      const res = await t.get('/v1/test-undecorated', await t.token());
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('leaked');
    });

    it('refuses such a handler without a token', async () => {
      const res = await t.get('/v1/test-undecorated');
      expect(res.statusCode).toBe(403);
    });
  });
});
