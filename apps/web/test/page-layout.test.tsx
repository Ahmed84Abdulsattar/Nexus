import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutModeForWidth } from '../src/app/layout/layoutMode';
import { PageLayout } from '../src/app/layout/PageLayout';

/** Fake window width for matchMedia `(min-width: Npx)` queries. */
function setWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: width >= min,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('layoutModeForWidth', () => {
  it.each([
    [390, 'mobile'],
    [767, 'mobile'],
    [768, 'tablet'],
    [1024, 'tablet'],
    [1279, 'tablet'],
    [1280, 'desktop'],
    [1440, 'desktop'],
  ] as const)('%ipx is %s', (width, mode) => {
    expect(layoutModeForWidth(width)).toBe(mode);
  });
});

const demo = (
  <PageLayout
    contentAs="div"
    listLabel="Assets"
    detailsLabel="Info"
    list={<p>L</p>}
    details={<p>D</p>}
  >
    <p>Centre</p>
  </PageLayout>
);

describe('PageLayout', () => {
  it('desktop shows list, content and details inline with no buttons', () => {
    setWidth(1440);
    render(demo);
    expect(screen.getByRole('region', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Info' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('tablet collapses the list to a button and keeps details inline', async () => {
    setWidth(1024);
    render(demo);
    expect(screen.queryByRole('region', { name: 'Assets' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Info' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Assets' }));
    expect(await screen.findByRole('dialog', { name: 'Assets' })).toBeInTheDocument();
  });

  it('mobile opens list and details as drawers; Esc closes and focus returns to the opener', async () => {
    setWidth(390);
    render(demo);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    const opener = screen.getByRole('button', { name: 'Info' });
    await userEvent.click(opener);
    expect(await screen.findByRole('dialog', { name: 'Info' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('renders no toolbar when there is nothing to open', () => {
    setWidth(390);
    render(
      <PageLayout contentAs="div">
        <p>Only</p>
      </PageLayout>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses a single <main> by default', () => {
    setWidth(1440);
    render(<PageLayout>x</PageLayout>);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});
