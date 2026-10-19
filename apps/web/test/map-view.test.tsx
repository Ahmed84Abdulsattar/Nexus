import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MapAdapterProps } from '../src/components/map/adapter';
import { MapView } from '../src/components/map';
import type { MapMarker } from '../src/components/map';
import { configBody, configHandler } from '../src/test/handlers';
import { server } from '../src/test/server';

// The adapter is mocked: these tests cover the wrapper, never the ArcGIS SDK (docs/09 section 7).
const adapterProps = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('../src/components/map/arcgis/ArcgisMap', () => ({
  default: (props: MapAdapterProps) => {
    adapterProps.calls.push(props);
    return <div data-testid="adapter" data-mode={props.mode} />;
  },
}));

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const markers: MapMarker[] = [
  {
    id: 'a',
    kind: 'project',
    lat: 24.4,
    lng: 54.4,
    icon: 'generic',
    colorKey: 'active',
    label: 'A',
  },
];

describe('<MapView> and the map key', () => {
  it('shows "Map key not configured" when the config key is empty, and does not load the adapter', async () => {
    server.use(configHandler(() => ''));
    render(wrap(<MapView mode="2d" markers={markers} />));
    expect(await screen.findByText('Map key not configured')).toBeInTheDocument();
    expect(screen.queryByTestId('adapter')).not.toBeInTheDocument();
  });

  it('treats a whitespace-only key as not configured', async () => {
    server.use(configHandler(() => '   '));
    render(wrap(<MapView mode="2d" markers={markers} />));
    expect(await screen.findByText('Map key not configured')).toBeInTheDocument();
  });

  it('renders the adapter with the key from /v1/config and the markers as one layer', async () => {
    server.use(configHandler(() => 'key-from-config'));
    adapterProps.calls.length = 0;
    render(wrap(<MapView mode="satellite" markers={markers} cluster />));
    const adapter = await screen.findByTestId('adapter');
    expect(adapter).toHaveAttribute('data-mode', 'satellite');
    const props = adapterProps.calls.at(-1) as MapAdapterProps;
    expect(props.apiKey).toBe('key-from-config');
    expect(props.layers).toEqual([{ id: 'markers', markers, cluster: true }]);
  });

  it('passes a mode change straight to the adapter, which swaps the view', async () => {
    server.use(configHandler(() => 'key-from-config'));
    const view = render(wrap(<MapView mode="2d" markers={markers} />));
    expect(await screen.findByTestId('adapter')).toHaveAttribute('data-mode', '2d');
    view.rerender(wrap(<MapView mode="3d" markers={markers} />));
    expect(await screen.findByTestId('adapter')).toHaveAttribute('data-mode', '3d');
  });

  it('shows an error state when /v1/config fails', async () => {
    server.use(
      http.get('*/v1/config', () =>
        HttpResponse.json({ title: 'x', status: 500 }, { status: 500 }),
      ),
    );
    render(wrap(<MapView mode="2d" markers={markers} />));
    expect(await screen.findByRole('alert')).toHaveTextContent('Map settings could not be loaded');
  });

  it('never shows the key on the page', async () => {
    server.use(configHandler(() => 'key-from-config'));
    const { container } = render(wrap(<MapView mode="2d" markers={markers} />));
    await screen.findByTestId('adapter');
    expect(container.innerHTML).not.toContain('key-from-config');
  });
});

it('the mock config body is the shared /v1/config contract', () => {
  expect(configBody('k').arcgis.apiKey).toBe('k');
  expect(configBody('k').featureFlags).toBeTypeOf('object');
});
