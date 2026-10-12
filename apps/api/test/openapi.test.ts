import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/auth.js';

const apps: TestApp[] = [];
async function appFor(appEnv: string, withTestRoutes = false): Promise<TestApp> {
  const t = await createTestApp({ withTestRoutes, docs: true, env: { APP_ENV: appEnv } });
  apps.push(t);
  return t;
}
afterAll(async () => {
  for (const t of apps) await t.app.close();
});

describe('/docs and /openapi.json by APP_ENV', () => {
  it.each(['local', 'dev'])('are served without a token when APP_ENV=%s', async (env) => {
    const t = await appFor(env);
    const ui = await t.get('/docs');
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    const spec = await t.get('/openapi.json');
    expect(spec.statusCode).toBe(200);
    expect(spec.json<{ openapi: string }>().openapi).toBe('3.1.0');
  });

  it('are not mounted when APP_ENV=prod (404 problem+json)', async () => {
    const t = await appFor('prod');
    for (const url of ['/docs', '/docs/', '/openapi.json']) {
      const res = await t.get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
  });
});

describe('the OpenAPI document', () => {
  it('registers ProblemDetails and documents it on the routes it can happen on', async () => {
    const t = await appFor('local', true);
    const doc = (await t.get('/openapi.json')).json<{
      components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    }>();
    expect(doc.components.schemas['ProblemDetails']).toBeDefined();
    expect(doc.components.securitySchemes['entra']).toBeDefined();
    const ref = {
      content: {
        'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
      },
    };
    const asset = doc.paths['/test-auth/asset']?.['get']?.responses;
    expect(asset?.['401']).toMatchObject(ref);
    expect(asset?.['403']).toMatchObject(ref);
    expect(doc.paths['/test-auth/projects/{projectId}']?.['get']?.responses['404']).toMatchObject(
      ref,
    );
    expect(doc.paths['/test-auth/echo']?.['post']?.responses['422']).toMatchObject(ref);
    // The @Public health route needs no token, so it documents no 401.
    expect(doc.paths['/health/live']?.['get']?.responses['401']).toBeUndefined();
  });

  it('matches the committed apps/api/openapi.json (run pnpm build to refresh it)', async () => {
    const t = await appFor('local');
    const live: unknown = (await t.get('/openapi.json')).json();
    const file: unknown = JSON.parse(
      readFileSync(fileURLToPath(new URL('../openapi.json', import.meta.url)), 'utf8'),
    );
    expect(live).toEqual(file);
  });
});
