import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * Writes apps/api/openapi.json (committed; `pnpm build` runs this from the compiled output).
 * The document comes from the route table only, so the environment values below are placeholders
 * that never reach the file. They are always forced, so a developer's real .env cannot change it.
 */
Object.assign(process.env, {
  APP_ENV: 'local',
  AUTH_MODE: 'entra',
  ENTRA_TENANT_ID: '00000000-0000-4000-8000-000000000000',
  ENTRA_API_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
  ENTRA_WEB_CLIENT_ID: '00000000-0000-4000-8000-000000000002',
  ENTRA_API_AUDIENCE: 'api://nexus-api',
});
delete process.env['ENTRA_JWKS_URL'];

// Imported after the environment is set, because AuthModule reads it when it is loaded.
const { AppModule } = await import('../app.module.js');
const { configureApp } = await import('../common/http/configure-app.js');
const { buildOpenApiDocument } = await import('./setup.js');

const outFile = resolve(dirname(fileURLToPath(import.meta.url)), '../../openapi.json');

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
try {
  configureApp(app);
  await app.init();
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(buildOpenApiDocument(app), null, 2) + '\n');
  console.log(`wrote ${outFile}`);
} finally {
  await app.close();
}
