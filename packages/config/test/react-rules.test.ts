import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: root });

// The first lintText loads the whole repo config and every plugin (about 11 s on an idle machine,
// several times that when all packages run at once). Later calls take 10 to 100 ms. Pay the cold
// start in the hook (hookTimeout 120 s) so the per-test limit only measures linting.
beforeAll(async () => {
  await eslint.lintText('export {};\n', { filePath: `${root}apps/web/src/warmup.ts` });
});

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: root + filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? '');
}

describe('React lint rules (apps/web)', () => {
  const file = 'apps/web/src/features/portfolio/C.tsx';

  it('flags a hook called conditionally', async () => {
    const code =
      "import { useState } from 'react';\nexport function C({ a }: { a: boolean }) {\n  if (a) { useState(0); }\n  return null;\n}\n";
    expect(await ruleIds(file, code)).toContain('react-hooks/rules-of-hooks');
  });
  it('flags missing effect dependencies', async () => {
    const code =
      "import { useEffect } from 'react';\nexport function C({ a }: { a: number }) {\n  useEffect(() => { console.log(a); }, []);\n  return null;\n}\n";
    expect(await ruleIds(file, code)).toContain('react-hooks/exhaustive-deps');
  });
  it('flags an image without alt text', async () => {
    const code = 'export const C = () => <img src="/a.png" />;\n';
    expect(await ruleIds(file, code)).toContain('jsx-a11y/alt-text');
  });
  it('does not apply the React rules outside apps/web', async () => {
    const code = 'export const C = () => <img src="/a.png" />;\n';
    expect(await ruleIds('apps/api/src/C.tsx', code)).not.toContain('jsx-a11y/alt-text');
  });
});
