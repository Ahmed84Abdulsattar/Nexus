import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(tsx?|css|html)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

// Hex, colour functions, CSS named colours used as values, and Tailwind palette classes (bg-red-500).
const RAW = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/,
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
  /\b(?:bg|text|border)-(?:white|black)\b/,
];

it('writes no colour value outside styles/tokens.css', () => {
  const offenders: string[] = [];
  for (const file of files(SRC)) {
    const rel = relative(SRC, file).replaceAll('\\', '/');
    if (rel === 'styles/tokens.css') continue;
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (RAW.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(offenders).toEqual([]);
});
