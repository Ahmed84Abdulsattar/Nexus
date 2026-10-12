import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestRouter } from '../src/app/router';
import { InfoBox, Tag } from '../src/components/ui';
import { SWATCHES } from '../src/features/dev/swatches';

const widths = { desktop: 1440, phone: 390 };
const original = window.innerWidth;
afterEach(() => {
  window.innerWidth = original;
  delete document.documentElement.dataset.theme;
});

describe.each(Object.entries(widths))('components page at %s width', (_n, width) => {
  it('shows every base component and every token with its text label', async () => {
    window.innerWidth = width;
    render(<RouterProvider router={createTestRouter('/dev/components')} />);
    expect(await screen.findByRole('heading', { name: 'Components' })).toBeInTheDocument();

    for (const title of ['Button', 'InfoBox', 'Table', 'Tabs', 'SidePanel']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Demo tabs' })).toBeInTheDocument();
    for (const s of SWATCHES) {
      expect(screen.getAllByText(s.label).length).toBeGreaterThan(0);
      expect(screen.getByText(`--${s.token}`)).toBeInTheDocument();
    }
  });
});

it('opens the side panel and switches theme', async () => {
  const user = userEvent.setup();
  render(<RouterProvider router={createTestRouter('/dev/components')} />);
  await screen.findByRole('heading', { name: 'Components' });
  await user.click(screen.getByRole('button', { name: 'Open side panel' }));
  expect(screen.getByRole('dialog', { name: 'Asset panel' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: /Theme:/ }));
  expect(document.documentElement.dataset.theme).toMatch(/light|dark/);
});

describe('Tag', () => {
  it('takes its text from props', () => {
    render(<Tag label="Any text the API sends" token="status-running" />);
    expect(screen.getByText('Any text the API sends')).toBeInTheDocument();
  });

  it('rejects a raw colour instead of a token name', () => {
    expect(() => render(<Tag label="x" token="#ff0000" />)).toThrow(/not a token name/);
  });
});

describe('InfoBox', () => {
  it('shows an em dash for missing data and freshness always', () => {
    render(<InfoBox title="Power" updated="14:32" />);
    const box = screen.getByRole('region', { name: 'Power' });
    expect(within(box).getByText('—')).toBeInTheDocument();
    expect(within(box).getByText('updated 14:32')).toBeInTheDocument();
  });

  it('says "no data yet" when the source does not carry the field', () => {
    render(<InfoBox title="Fuel" updated={null} />);
    expect(screen.getByText('no data yet')).toBeInTheDocument();
  });

  it('marks stale values in words, not colour alone', () => {
    render(
      <InfoBox title="Power" updated="09:10" stale>
        42 kW
      </InfoBox>,
    );
    expect(screen.getByText('Stale.')).toBeInTheDocument();
  });
});
