import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapAdapterProps } from '../src/components/map/adapter';
import { MapView } from '../src/components/map';
import { configBody, configHandler } from '../src/test/handlers';
import { server } from '../src/test/server';

// QA checks for S0-09 config handling (task: key never logged or stored; responses validated).
vi.mock('../src/components/map/arcgis/ArcgisMap', () => ({
  default: (props: MapAdapterProps) => <div data-testid="adapter" data-mode={props.mode} />,
}));

const KEY = 'qa-placeholder-key-0123456789';

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('/v1/config is validated with the shared zod schema', () => {
  it('shows the error state for a body without the arcgis block, never a map', async () => {
    server.use(http.get('*/v1/config', () => HttpResponse.json({ enums: {}, featureFlags: {} })));
    render(wrap(<MapView mode="2d" markers={[]} />));
    expect(await screen.findByRole('alert')).toHaveTextContent('Map settings could not be loaded');
    expect(screen.queryByTestId('adapter')).not.toBeInTheDocument();
  });

  it('shows the error state when the key is not a string', async () => {
    server.use(
      http.get('*/v1/config', () =>
        HttpResponse.json({ ...configBody(''), arcgis: { apiKey: 12345 } }),
      ),
    );
    render(wrap(<MapView mode="2d" markers={[]} />));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('adapter')).not.toBeInTheDocument();
  });

  it('shows the error state for an empty 200 response', async () => {
    server.use(http.get('*/v1/config', () => new HttpResponse(null, { status: 200 })));
    render(wrap(<MapView mode="2d" markers={[]} />));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('the key is never logged or stored', () => {
  it('writes nothing containing the key to the console, web storage or cookies', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level),
    );
    server.use(configHandler(() => KEY));
    render(wrap(<MapView mode="2d" markers={[]} />));
    await screen.findByTestId('adapter');
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String));
    expect(logged.filter((line) => line.includes(KEY))).toEqual([]);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(KEY);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(KEY);
    expect(document.cookie).not.toContain(KEY);
  });

  it('product source never passes the key to console, storage or a URL', () => {
    const src = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');
    const files = [
      'components/map/MapView.tsx',
      'components/map/arcgis/ArcgisMap.tsx',
      'components/map/arcgis/factory.ts',
      'api/queries/useConfig.ts',
      'features/portfolio/PortfolioPage.tsx',
    ];
    for (const file of files) {
      const text = src(file);
      expect(text, file).not.toMatch(/console\.\w+\([^)]*apiKey/);
      expect(text, file).not.toMatch(/(?:local|session)Storage[^;]*apiKey/);
      expect(text, file).not.toMatch(/[?&](?:token|apiKey|key)=\$\{/);
    }
    // The key is assigned to the SDK in exactly one place.
    const assignments = files.filter((f) => /esriConfig\.apiKey\s*=/.test(src(f)));
    expect(assignments).toEqual(['components/map/arcgis/factory.ts']);
  });
});

describe('/v1/projects is validated with the shared zod schema', () => {
  it('the project query rejects a body with an unknown state type instead of drawing it', async () => {
    const { fetchProjects } = await import('../src/api/queries/useProjects');
    server.use(
      http.get('*/v1/projects', () =>
        HttpResponse.json({ items: [{ id: 1, name: 'x' }], nextCursor: null }),
      ),
    );
    await expect(fetchProjects()).rejects.toThrow();
  });
});
