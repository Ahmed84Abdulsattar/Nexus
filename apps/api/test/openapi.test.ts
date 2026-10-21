import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registeredSchemas } from '../src/common/http/dto.js';
import { mountDocs } from '../src/openapi/setup.js';
import { createTestApp, nullableKindsSchema, type TestApp } from './helpers/auth.js';

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

  it('serves no /docs-yaml', async () => {
    const t = await appFor('local');
    expect((await t.get('/docs-yaml')).statusCode).toBe(404);
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

it('mounts docs only for an allow-list of environments', () => {
  const noApp = {} as never;
  expect(mountDocs(noApp, 'prod')).toBe(false);
  expect(mountDocs(noApp, 'staging' as never)).toBe(false);
});

describe('the /v1 prefix', () => {
  it('puts routes under /v1 but keeps /health, /docs and /openapi.json outside it', async () => {
    const t = await appFor('local', true);
    expect((await t.get('/health/live')).statusCode).toBe(200);
    expect((await t.get('/v1/health/live')).statusCode).toBe(404);
    expect((await t.get('/docs')).statusCode).toBe(200);
    expect((await t.get('/v1/docs')).statusCode).toBe(404);
    expect((await t.get('/v1/openapi.json')).statusCode).toBe(404);
    // An unprefixed API route does not exist.
    expect((await t.get('/test-auth/public')).statusCode).toBe(404);
    expect((await t.get('/v1/test-auth/public')).statusCode).toBe(200);
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
    const asset = doc.paths['/v1/test-auth/asset']?.['get']?.responses;
    expect(asset?.['401']).toMatchObject(ref);
    expect(asset?.['403']).toMatchObject(ref);
    expect(
      doc.paths['/v1/test-auth/projects/{projectId}']?.['get']?.responses['404'],
    ).toMatchObject(ref);
    expect(doc.paths['/v1/test-auth/echo']?.['post']?.responses['422']).toMatchObject(ref);
    // The @Public health route needs no token, so it documents no 401.
    expect(doc.paths['/health/live']?.['get']?.responses['401']).toBeUndefined();
  });

  type Schema = Record<string, unknown>;
  const schemasOf = (doc: unknown): Record<string, Schema> =>
    (doc as { components: { schemas: Record<string, Schema> } }).components.schemas;
  const typesOf = (s: Schema | undefined): string[] => {
    if (!s) return [];
    const own = Array.isArray(s['type'])
      ? (s['type'] as string[])
      : s['type']
        ? [s['type'] as string]
        : [];
    const any = ((s['anyOf'] as Schema[] | undefined) ?? []).flatMap((b) => typesOf(b));
    return [...own, ...any];
  };

  it('describes /v1/me name and email as string or null (not an array)', async () => {
    const t = await appFor('local');
    const me = schemasOf((await t.get('/openapi.json')).json())['MeResponseDto_Output'] as {
      properties: Record<string, Schema>;
    };
    for (const field of ['name', 'email']) {
      const types = typesOf(me.properties[field]);
      expect(types, field).toContain('string');
      expect(types, field).toContain('null');
      expect(types, field).not.toContain('array');
    }
  });

  it('renders every nullable scalar as its type plus null, never as an array', async () => {
    const t = await appFor('local', true);
    const schemas = schemasOf((await t.get('/openapi.json')).json());
    const dto = schemas['NullableKindsDto_Output'] as { properties: Record<string, Schema> };
    const expected: Record<string, string> = {
      text: 'string',
      id: 'string',
      bounded: 'string',
      count: 'integer',
      ratio: 'number',
      flag: 'boolean',
      kind: 'string',
    };
    for (const [field, type] of Object.entries(expected)) {
      const types = typesOf(dto.properties[field]);
      expect(types, field).toEqual(expect.arrayContaining([type, 'null']));
      expect(types, field).not.toContain('array');
    }
    // Value constraints stay on the non-null branch.
    expect(JSON.stringify(dto.properties['bounded'])).toContain('"maxLength":5');
    expect(JSON.stringify(dto.properties['kind'])).toContain('"enum":["a","b"]');
    // A real array stays an array, and a nullable array is an array or null.
    expect(dto.properties['list']?.['type']).toBe('array');
    expect(typesOf(dto.properties['maybeList'])).toEqual(expect.arrayContaining(['array', 'null']));
  });

  it('keeps every nullable property of every DTO nullable in the document', async () => {
    const t = await appFor('local', true);
    const docSchemas = Object.values(schemasOf((await t.get('/openapi.json')).json()));
    expect(registeredSchemas).toContain(nullableKindsSchema);
    for (const schema of registeredSchemas) {
      const json = z.toJSONSchema(schema, { io: 'output' }) as {
        properties?: Record<string, { type?: unknown }>;
      };
      const nullable = Object.entries(json.properties ?? {}).filter(
        ([, p]) => Array.isArray(p.type) && p.type.includes('null'),
      );
      if (nullable.length === 0) continue;
      const names = Object.keys(json.properties ?? {})
        .sort()
        .join();
      const component = docSchemas.find(
        (c) =>
          Object.keys((c['properties'] as object | undefined) ?? {})
            .sort()
            .join() === names,
      ) as { properties: Record<string, Schema> } | undefined;
      expect(component, `component for ${names}`).toBeDefined();
      for (const [field] of nullable) {
        const types = typesOf(component?.properties[field]);
        expect(types, field).toContain('null');
      }
    }
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
