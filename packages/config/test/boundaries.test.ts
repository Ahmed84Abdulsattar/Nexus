import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: root });

async function messages(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: root + filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-imports')
    .map((m) => m.message);
}

describe('import boundary rules', () => {
  describe('@arcgis/*', () => {
    const code = "import Map from '@arcgis/core/Map';\nexport const m = Map;\n";

    it('fails in a feature folder', async () => {
      expect(await messages('apps/web/src/features/portfolio/Page.tsx', code)).toHaveLength(1);
    });
    it('fails in components/map outside arcgis/', async () => {
      expect(await messages('apps/web/src/components/map/MapView.tsx', code)).toHaveLength(1);
    });
    it('fails in the api and worker', async () => {
      expect(await messages('apps/api/src/main.ts', code)).toHaveLength(1);
      expect(await messages('apps/worker/src/main.ts', code)).toHaveLength(1);
    });
    it('passes in components/map/arcgis/', async () => {
      expect(await messages('apps/web/src/components/map/arcgis/view.ts', code)).toHaveLength(0);
    });
  });

  describe('@nexus/datoms-client', () => {
    const code =
      "import { DatomsClient } from '@nexus/datoms-client';\nexport const c = DatomsClient;\n";

    it('fails in apps/api, apps/web, apps/worker and packages/shared', async () => {
      for (const file of [
        'apps/api/src/app.module.ts',
        'apps/web/src/app/App.tsx',
        'apps/worker/src/worker.module.ts',
        'packages/shared/src/index.ts',
      ]) {
        expect(await messages(file, code), file).toHaveLength(1);
      }
    });
    it('passes in packages/connectors/datoms', async () => {
      expect(await messages('packages/connectors/datoms/src/index.ts', code)).toHaveLength(0);
    });
  });

  describe('@nexus/connectors-*', () => {
    const code =
      "import { DatomsConnector } from '@nexus/connectors-datoms';\nexport const c = DatomsConnector;\n";

    it('fails in apps/api and apps/web', async () => {
      expect(await messages('apps/api/src/app.module.ts', code)).toHaveLength(1);
      expect(await messages('apps/web/src/app/App.tsx', code)).toHaveLength(1);
    });
    it('passes in apps/worker', async () => {
      expect(await messages('apps/worker/src/worker.module.ts', code)).toHaveLength(0);
    });
    it('lets the connectors and testing package use the core interface only', async () => {
      const core =
        "import type { SourceConnector } from '@nexus/connectors-core';\nexport type T = SourceConnector;\n";
      expect(await messages('packages/connectors/datoms/src/index.ts', core)).toHaveLength(0);
      expect(await messages('packages/testing/src/index.ts', core)).toHaveLength(0);
      expect(await messages('packages/testing/src/index.ts', code)).toHaveLength(1);
    });
  });
});
