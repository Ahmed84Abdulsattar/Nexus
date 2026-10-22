import { describe, expect, it } from 'vitest';
import { assertWebEnv } from '../plugins/envGuards';

const ok = { VITE_API_BASE_URL: 'https://api.test/v1', VITE_ENTRA_TENANT_ID: 't' };

describe('assertWebEnv', () => {
  it('accepts the allowed public variables in a build', () => {
    expect(() => assertWebEnv({ command: 'build', nodeEnv: 'production', env: ok })).not.toThrow();
  });
  it('rejects any other VITE_ variable, in a build and in dev', () => {
    for (const command of ['build', 'serve'] as const) {
      expect(() =>
        assertWebEnv({ command, nodeEnv: undefined, env: { ...ok, VITE_SECRET_THING: 'x' } }),
      ).toThrow(/VITE_SECRET_THING is not an allowed/);
    }
  });
  it("allows Vite's own VITE_USER_NODE_ENV (set when .env contains NODE_ENV), but a build refuses 'development'", () => {
    const dev = { ...ok, VITE_USER_NODE_ENV: 'development' };
    expect(() => assertWebEnv({ command: 'serve', nodeEnv: 'production', env: dev })).not.toThrow();
    expect(() => assertWebEnv({ command: 'build', nodeEnv: 'production', env: dev })).toThrow(
      /VITE_USER_NODE_ENV=development/,
    );
    const prod = { ...ok, VITE_USER_NODE_ENV: 'production' };
    expect(() =>
      assertWebEnv({ command: 'build', nodeEnv: 'production', env: prod }),
    ).not.toThrow();
  });
  it('allows the dev ArcGIS key in serve mode only', () => {
    const env = { ...ok, VITE_DEV_ARCGIS_API_KEY: 'set' };
    expect(() => assertWebEnv({ command: 'serve', nodeEnv: undefined, env })).not.toThrow();
    expect(() => assertWebEnv({ command: 'build', nodeEnv: 'production', env })).toThrow(
      /VITE_DEV_ARCGIS_API_KEY/,
    );
  });
  it('tolerates an empty dev-key placeholder in a build, and never prints a value', () => {
    expect(() =>
      assertWebEnv({
        command: 'build',
        nodeEnv: 'production',
        env: { ...ok, VITE_DEV_ARCGIS_API_KEY: '' },
      }),
    ).not.toThrow();
    try {
      assertWebEnv({
        command: 'build',
        nodeEnv: 'production',
        env: { VITE_DEV_ARCGIS_API_KEY: 'zq9zq9' },
      });
    } catch (error) {
      expect(String(error)).not.toContain('zq9zq9');
    }
  });
  it('rejects a build with NODE_ENV=development', () => {
    expect(() => assertWebEnv({ command: 'build', nodeEnv: 'development', env: ok })).toThrow(
      /NODE_ENV=development/,
    );
    expect(() => assertWebEnv({ command: 'serve', nodeEnv: 'development', env: ok })).not.toThrow();
  });
});

describe('L4: dev switches in a build', () => {
  it("a build throws for VITE_AUTH_MODE='dev' and VITE_USE_MOCKS='false', and passes for ''", () => {
    const build = (env: Record<string, string>) =>
      assertWebEnv({ command: 'build', nodeEnv: 'production', env: { ...ok, ...env } });
    expect(() => build({ VITE_AUTH_MODE: 'dev' })).toThrow(/VITE_AUTH_MODE/);
    expect(() => build({ VITE_USE_MOCKS: 'false' })).toThrow(/VITE_USE_MOCKS/);
    expect(() => build({ VITE_AUTH_MODE: '', VITE_USE_MOCKS: '' })).not.toThrow();
  });
});
