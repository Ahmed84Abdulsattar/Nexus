import { describe, expect, it } from 'vitest';
import { DatabaseConfigError, describeDatabaseUrl, resolveDatabaseUrl } from '../src/urls.js';

const API = 'postgres://nexus_api_local@localhost:5432/nexus';
const WORKER = 'postgres://nexus_worker_local@localhost:5432/nexus';
const ADMIN = 'postgres://nexus@localhost:5432/nexus';

describe('resolveDatabaseUrl', () => {
  it('uses each role own variable', () => {
    const env = { APP_ENV: 'prod', DATABASE_URL: API, WORKER_DATABASE_URL: WORKER, DATABASE_ADMIN_URL: ADMIN };
    expect(resolveDatabaseUrl(env, 'api')).toEqual({ url: API, variable: 'DATABASE_URL', fellBack: false });
    expect(resolveDatabaseUrl(env, 'worker').url).toBe(WORKER);
    expect(resolveDatabaseUrl(env, 'admin').url).toBe(ADMIN);
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

describe('describeDatabaseUrl', () => {
  it('shows host, port and database but no credentials', () => {
    expect(describeDatabaseUrl('postgres://u:secret@db.example:5433/nexus?sslmode=require')).toBe(
      'db.example:5433/nexus',
    );
  });
});
