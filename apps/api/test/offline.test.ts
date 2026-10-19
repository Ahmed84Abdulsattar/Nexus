import 'reflect-metadata';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/http/configure-app.js';
import { apiPackageRoot, applyOfflineEnvironment, OFFLINE_ENV } from '../src/openapi/offline.js';

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('the OpenAPI generator environment (Q32)', () => {
  it('drops everything outside the allow-list and sets placeholders', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/bin',
      DATABASE_URL: 'postgres://real:secret@prod.example/nexus',
      WORKER_DATABASE_URL: 'postgres://real:secret@prod.example/nexus',
      DATOMS_TOKEN: 'token',
      KEY_VAULT_URI: 'https://kv.example',
      ENTRA_JWKS_URL: 'https://evil.example/keys',
      APP_ENV: 'prod',
    };
    applyOfflineEnvironment(env);
    expect(env['PATH']).toBe('/bin');
    expect(env['DATOMS_TOKEN']).toBeUndefined();
    expect(env['KEY_VAULT_URI']).toBeUndefined();
    expect(env['ENTRA_JWKS_URL']).toBeUndefined();
    expect(env['WORKER_DATABASE_URL']).toBeUndefined();
    expect(env['APP_ENV']).toBe('local');
    expect(env['DATABASE_URL']).toBe(OFFLINE_ENV['DATABASE_URL']);
    expect(new URL(env['DATABASE_URL']!).hostname.endsWith('.invalid')).toBe(true);
  });
});

describe('where the generator writes', () => {
  it('is the apps/api folder of the checkout it runs from, whatever the cwd', () => {
    const here = pathToFileURL(join(API_ROOT, 'src/openapi/generate.ts')).href;
    expect(apiPackageRoot(here, API_ROOT).toLowerCase()).toBe(
      API_ROOT.replace(/[\\/]$/, '').toLowerCase(),
    );
    // a cwd that is not inside any @nexus/api folder (a root build, CI) is fine
    expect(() => apiPackageRoot(here, tmpdir())).not.toThrow();
  });

  it('refuses to write when the cwd belongs to another @nexus/api folder', () => {
    const other = mkdtempSync(join(tmpdir(), 'nexus-other-'));
    writeFileSync(join(other, 'package.json'), JSON.stringify({ name: '@nexus/api' }));
    mkdirSync(join(other, 'src'));
    const here = pathToFileURL(join(API_ROOT, 'src/openapi/generate.ts')).href;
    expect(() => apiPackageRoot(here, join(other, 'src'))).toThrow(/Refusing to write/);
  });
});

describe('building the app for the generator touches no network', () => {
  let trap: Server;
  let connections: Socket[];
  let port: number;
  const saved = { ...process.env };

  beforeEach(async () => {
    connections = [];
    trap = createServer((socket) => {
      connections.push(socket);
      socket.destroy();
    });
    await new Promise<void>((resolve) => trap.listen(0, '127.0.0.1', resolve));
    port = (trap.address() as { port: number }).port;
  });
  afterEach(async () => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
    await new Promise((resolve) => trap.close(resolve));
  });

  async function boot(init: boolean): Promise<void> {
    applyOfflineEnvironment(process.env);
    // The trap is a reachable "database", to prove that nothing in the app connects by itself.
    process.env['DATABASE_URL'] = `postgres://trap@127.0.0.1:${port}/trap`;
    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    try {
      configureApp(app);
      if (init) await app.init();
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      await app.close();
    }
  }

  it('creating the app, as the generator does, makes no connection', async () => {
    await boot(false);
    expect(connections).toHaveLength(0);
  });

  it('(control) initialising the app does connect: the LISTEN connection', async () => {
    await boot(true);
    expect(connections.length).toBeGreaterThan(0);
  });
});
