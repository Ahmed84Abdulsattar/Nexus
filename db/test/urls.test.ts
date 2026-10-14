import { describe, expect, it } from 'vitest';
import { DatabaseConfigError, describeDatabaseUrl, requireTlsUnlessLocal, resolveDatabaseUrl } from '../src/urls.js';

const API = 'postgres://nexus_api_local@localhost:5432/nexus';
const WORKER = 'postgres://nexus_worker_local@localhost:5432/nexus';
const ADMIN = 'postgres://nexus@localhost:5432/nexus';

describe('resolveDatabaseUrl', () => {
  it('uses each role own variable', () => {
    const tls = (u: string): string => u + '?sslmode=verify-full';
    const env = { APP_ENV: 'prod', DATABASE_URL: tls(API), WORKER_DATABASE_URL: tls(WORKER), DATABASE_ADMIN_URL: tls(ADMIN) };
    expect(resolveDatabaseUrl(env, 'api')).toEqual({ url: tls(API), variable: 'DATABASE_URL', fellBack: false });
    expect(resolveDatabaseUrl(env, 'worker').url).toBe(tls(WORKER));
    expect(resolveDatabaseUrl(env, 'admin').url).toBe(tls(ADMIN));
  });

  it('falls back to DATABASE_URL for admin and worker only when APP_ENV=local', () => {
    const env = { APP_ENV: 'local', DATABASE_URL: ADMIN };
    expect(resolveDatabaseUrl(env, 'admin')).toEqual({ url: ADMIN, variable: 'DATABASE_URL', fellBack: true });
    expect(resolveDatabaseUrl(env, 'worker').fellBack).toBe(true);
  });

  it.each(['dev', 'prod', undefined, 'staging'])('never falls back when APP_ENV is %s', (appEnv) => {
    const env = { ...(appEnv ? { APP_ENV: appEnv } : {}), DATABASE_URL: API };
    expect(() => resolveDatabaseUrl(env, 'admin')).toThrow(/DATABASE_ADMIN_URL is not set/);
    expect(() => resolveDatabaseUrl(env, 'worker')).toThrow(/WORKER_DATABASE_URL is not set/);
  });

  it('never falls back for the api', () => {
    expect(() => resolveDatabaseUrl({ APP_ENV: 'local', WORKER_DATABASE_URL: WORKER }, 'api')).toThrow(
      /DATABASE_URL is not set/,
    );
  });

  it('treats an empty value as unset', () => {
    expect(() => resolveDatabaseUrl({ APP_ENV: 'prod', DATABASE_ADMIN_URL: '  ' }, 'admin')).toThrow(
      DatabaseConfigError,
    );
  });

  it('rejects other schemes and never prints the value', () => {
    const secret = 'mysql://user:hunter2@host/db';
    try {
      resolveDatabaseUrl({ APP_ENV: 'local', DATABASE_URL: secret }, 'api');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/must start with postgres/);
      expect((error as Error).message).not.toContain('hunter2');
    }
    expect(() => resolveDatabaseUrl({ DATABASE_URL: 'not a url hunter2' }, 'api')).toThrow(/not a valid URL/);
  });
});

describe('TLS outside local (L9)', () => {
  const plain = 'postgres://u:secret@db.example:5432/nexus';
  it.each(['dev', 'prod', undefined])('requires TLS for all three URLs when APP_ENV is %s', (appEnv) => {
    const base = appEnv ? { APP_ENV: appEnv } : {};
    for (const [role, variable] of [['api', 'DATABASE_URL'], ['worker', 'WORKER_DATABASE_URL'], ['admin', 'DATABASE_ADMIN_URL']] as const) {
      expect(() => resolveDatabaseUrl({ ...base, [variable]: plain }, role)).toThrow(/must use TLS/);
      expect(() => resolveDatabaseUrl({ ...base, [variable]: plain + '?sslmode=prefer' }, role)).toThrow(/must use TLS/);
      expect(() => resolveDatabaseUrl({ ...base, [variable]: plain + '?sslmode=disable' }, role)).toThrow(/must use TLS/);
      for (const ok of ['require', 'verify-ca', 'verify-full']) {
        expect(resolveDatabaseUrl({ ...base, [variable]: plain + '?sslmode=' + ok }, role).url).toContain(ok);
      }
    }
  });

  it('does not print the URL when it refuses', () => {
    try {
      resolveDatabaseUrl({ APP_ENV: 'prod', DATABASE_URL: plain }, 'api');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('secret');
    }
  });

  it('does not require TLS locally', () => {
    expect(resolveDatabaseUrl({ APP_ENV: 'local', DATABASE_URL: plain }, 'api').url).toBe(plain);
    expect(requireTlsUnlessLocal(plain, 'X', 'local')).toBe(plain);
  });
});

describe('describeDatabaseUrl', () => {
  it('shows host, port and database but no credentials', () => {
    expect(describeDatabaseUrl('postgres://u:secret@db.example:5433/nexus?sslmode=require')).toBe(
      'db.example:5433/nexus',
    );
  });
});
