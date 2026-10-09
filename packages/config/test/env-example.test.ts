import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** Variable names from the "Environment variables" table in docs/04-tech-stack.md. */
function documentedVariables(): string[] {
  const doc = readFileSync(root + 'docs/04-tech-stack.md', 'utf8');
  const section = doc.split('## Environment variables')[1]?.split('\n## ')[0] ?? '';
  const names = new Set<string>();
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    // First two columns only: the variable name(s) and "used by" (which names VITE_* twins).
    const [, names1, names2] = line.split('|');
    for (const col of [names1, names2]) {
      for (const [, token] of (col ?? '').matchAll(/`([^`]+)`/g)) {
        if (token && /^[A-Z][A-Z0-9_]*$/.test(token)) names.add(token);
      }
    }
  }
  return [...names];
}

describe('.env.example', () => {
  const example = readFileSync(root + '.env.example', 'utf8');
  const assignments = example
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'))
    .map((l) => l.split('=') as [string, ...string[]]);

  it('lists every variable in docs/04', () => {
    const documented = documentedVariables();
    expect(documented.length).toBeGreaterThan(20);
    const listed = assignments.map(([name]) => name);
    expect(documented.filter((n) => !listed.includes(n))).toEqual([]);
  });

  it('has no values', () => {
    for (const [name, ...rest] of assignments) {
      expect(rest.join('='), name).toBe('');
    }
  });
});
