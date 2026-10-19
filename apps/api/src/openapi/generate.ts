import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { apiPackageRoot, applyOfflineEnvironment } from './offline.js';

/**
 * Writes apps/api/openapi.json (committed; `pnpm build` runs this from the compiled output).
 * The document comes from the route table only. The environment is replaced by an allow-list and
 * placeholders first (offline.ts), so a developer's real .env or shell can neither change the file
 * nor make the build touch a database or any other service (Q32). The app is created but never
 * initialised: no lifecycle hook runs, so nothing connects anywhere.
 */
applyOfflineEnvironment(process.env);

// Imported after the environment is set, because the config modules read it when they are loaded.
const { AppModule } = await import('../app.module.js');
const { configureApp } = await import('../common/http/configure-app.js');
const { buildOpenApiDocument } = await import('./setup.js');

// The apps/api folder of the checkout being built (a git worktree writes into itself).
const outFile = join(apiPackageRoot(import.meta.url), 'openapi.json');

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
try {
  configureApp(app);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(buildOpenApiDocument(app), null, 2) + '\n');
  console.log(`wrote ${outFile}`);
} finally {
  await app.close();
}
