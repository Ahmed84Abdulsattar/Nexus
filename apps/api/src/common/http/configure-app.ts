import type { INestApplication } from '@nestjs/common';

export const API_PREFIX = 'v1';

/**
 * App-wide HTTP setup shared by main.ts, the OpenAPI generator and the test app, so the route
 * table (and therefore openapi.json) is the same everywhere. Everything is under /v1 except
 * /health/* (docs/10). /docs and /openapi.json are mounted by mountDocs() and stay unprefixed.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health/{*path}'] });
}
