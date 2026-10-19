import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: root });

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
