import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SWATCHES } from '../src/features/dev/swatches';
import { STATE_STATUS_TOKENS } from '../src/styles/tokens';

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

it('tokens.ts lists exactly the state and status tokens declared in tokens.css', () => {
  const declared = [...css.matchAll(/--((?:state|status)-[a-z-]+)\s*:/g)].map((m) => m[1]!);
  expect([...new Set(declared)].sort()).toEqual([...STATE_STATUS_TOKENS].sort());
});

/** Token values of one block (`:root` = light, `[data-theme='dark']` = dark). */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]!] = m[2]!;
  return out;
}

const light = block(':root');
const themes = { light, dark: { ...light, ...block("[data-theme='dark']") } };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(Object.entries(themes))('%s theme contrast (WCAG AA)', (_name, t) => {
  const get = (k: string) => {
    const v = t[k];
    if (!v) throw new Error(`token --${k} missing`);
    return v;
  };

  it('defines all nine state and status tokens', () => {
    for (const s of SWATCHES) expect(t[s.token], s.token).toBeDefined();
    expect(SWATCHES).toHaveLength(9);
  });

  it.each(SWATCHES.map((s) => s.token))(
    '%s marker is at least 3:1 on bg and surface (non-text)',
    (token) => {
      expect(contrast(get(token), get('bg'))).toBeGreaterThanOrEqual(3);
      expect(contrast(get(token), get('surface'))).toBeGreaterThanOrEqual(3);
    },
  );

  it.each([
    ['fg', 'bg'],
    ['fg', 'surface'],
    ['fg', 'surface-raised'],
    ['fg-muted', 'bg'],
    ['fg-muted', 'surface'],
    ['fg-muted', 'surface-raised'],
    ['primary-fg', 'primary'],
  ])('text --%s on --%s is at least 4.5:1', (fg, bg) => {
    expect(contrast(get(fg), get(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('borders and focus ring are at least 3:1 where they carry meaning', () => {
    expect(contrast(get('border-strong'), get('bg'))).toBeGreaterThanOrEqual(3);
    expect(contrast(get('focus-ring'), get('bg'))).toBeGreaterThanOrEqual(3);
  });
});
