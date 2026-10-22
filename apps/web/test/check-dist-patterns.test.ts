import { describe, expect, it } from 'vitest';
import { FORBIDDEN } from '../plugins/checkDist';

const matches = (text: string): string[] =>
  FORBIDDEN.filter(([re]) => re.test(text)).map(([, what]) => what);

describe('check-dist forbidden patterns', () => {
  it.each([
    'fetch(base + "/dev/token")',
    'sessionStorage.setItem("nexus.devAuth.user", k)',
    'import.meta.env.VITE_AUTH_MODE',
    '"VITE_USE_MOCKS"',
    'label="Local development sign-in"',
  ])('finds local dev sign-in code in %s', (code) => {
    expect(matches(code)).toContain('local dev sign-in code');
  });

  it('finds the other test-only markers', () => {
    expect(matches('mockServiceWorker.js')).toContain('MSW');
    expect(matches('Sample project 01')).toContain('sample markers');
  });

  it('does not flag ordinary application code', () => {
    expect(matches('const path = "/v1/me"; header.textContent = "Sign in as"')).toEqual([]);
  });
});
