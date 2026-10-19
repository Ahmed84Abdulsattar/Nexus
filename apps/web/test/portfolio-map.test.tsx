import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { MapAdapterProps } from '../src/components/map/adapter';
import { PortfolioPage } from '../src/features/portfolio/PortfolioPage';
import { configHandler, projectsHandler } from '../src/test/handlers';
import { SAMPLE_PROJECTS } from '../src/test/sampleProjects';
import { server } from '../src/test/server';

const last = vi.hoisted(() => ({ props: undefined as MapAdapterProps | undefined }));
vi.mock('../src/components/map/arcgis/ArcgisMap', () => ({
  default: (props: MapAdapterProps) => {
    last.props = props;
    return <div data-testid="adapter" data-mode={props.mode} />;
  },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PortfolioPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('portfolio placeholder (MSW)', () => {
  it('passes the 10 sample projects to <MapView> as markers coloured by state', async () => {
    server.use(configHandler(() => 'test-key'));
    renderPage();
    await screen.findByTestId('adapter');
    await screen.findByText('Sample project 01');
    const markers = last.props!.layers[0]!.markers;
    expect(markers).toHaveLength(10);
    expect(markers.every((m) => m.kind === 'project')).toBe(true);
    expect(markers.find((m) => m.id === 'sample-04')?.colorKey).toBe('central_store');
    expect(last.props!.layers[0]!.cluster).toBe(true);
  });

  it('lists every project with its state as text (not colour alone)', async () => {
    server.use(configHandler(() => 'test-key'));
    renderPage();
    const list = await screen.findByRole('list');
    await within(list).findByText('Sample project 10');
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(within(list).getAllByText('Active')).toHaveLength(4);
    expect(within(list).getAllByText('Central store')).toHaveLength(2);
  });

  it('switches 2D -> satellite -> 3D through the mode radios', async () => {
    server.use(configHandler(() => 'test-key'));
    const user = userEvent.setup();
    renderPage();
    const adapter = await screen.findByTestId('adapter');
    expect(adapter).toHaveAttribute('data-mode', '2d');
    await user.click(screen.getByRole('radio', { name: 'Satellite' }));
    expect(screen.getByTestId('adapter')).toHaveAttribute('data-mode', 'satellite');
    await user.click(screen.getByRole('radio', { name: '3D' }));
    expect(screen.getByTestId('adapter')).toHaveAttribute('data-mode', '3d');
  });

  it('lists a project without coordinates under "Not on map" and does not place it', async () => {
    server.use(
      configHandler(() => 'test-key'),
      projectsHandler([
        ...SAMPLE_PROJECTS.slice(0, 2),
        { id: 'x', name: 'No position', state: 'active', latitude: null, longitude: null },
      ]),
    );
    renderPage();
    await screen.findByText(/Not on map/);
    expect(screen.getByText(/No position/, { selector: 'p' })).toBeInTheDocument();
    expect(last.props!.layers[0]!.markers.map((m) => m.id)).toEqual(['sample-01', 'sample-02']);
  });

  it('shows the "Map key not configured" state but keeps the project list when there is no key', async () => {
    server.use(configHandler(() => ''));
    renderPage();
    expect(await screen.findByText('Map key not configured')).toBeInTheDocument();
    expect(await screen.findByText('Sample project 01')).toBeInTheDocument();
  });
});
