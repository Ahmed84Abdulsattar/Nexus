import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestRouter } from '../src/app/router';
import { Header } from '../src/app/layout';
import { type CurrentSession } from '../src/auth';

const original = window.innerWidth;
afterEach(() => {
  window.innerWidth = original;
});

// Test data only. Product code never carries a name.
const sample: CurrentSession = { user: { name: 'Sample User' }, signOut: vi.fn() };
const nobody: CurrentSession = { user: null, signOut: null };

function renderHeader(session: CurrentSession) {
  render(
    <MemoryRouter>
      <Header session={session} />
    </MemoryRouter>,
  );
  return screen.getByRole('banner');
}

describe('header at 1440 px (matches the mockup header)', () => {
  it('shows logo, search, UAE label, bell and avatar', () => {
    window.innerWidth = 1440;
    const header = renderHeader(sample);
    expect(within(header).getByRole('link', { name: /Innovo Nexus/ })).toHaveAttribute('href', '/');
    expect(within(header).getByText('Innovo')).toBeInTheDocument();
    expect(within(header).getByText('Nexus')).toBeInTheDocument();
    expect(within(header).getByRole('search')).toBeInTheDocument();
    expect(within(header).getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
    expect(within(header).getByText('UAE')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'User menu' })).toBeInTheDocument();
  });

  it('shows no notification count and the search does nothing', () => {
    const header = renderHeader(sample);
    expect(within(header).getByRole('button', { name: 'Notifications' })).toHaveTextContent('');
    expect(within(header).getByRole('searchbox')).toBeDisabled();
  });

  it('has a search icon button for phones so nothing overflows at 390 px', () => {
    window.innerWidth = 390;
    const header = renderHeader(sample);
    // Wide search box is `hidden md:flex`, the icon button is `md:hidden`.
    expect(within(header).getByRole('button', { name: /Search/ })).toHaveClass('md:hidden');
    expect(within(header).getByRole('searchbox').closest('label')).toHaveClass('hidden', 'md:flex');
  });
});

describe('user menu', () => {
  it('opens with Enter, shows the name and sign-out, closes with Escape', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn();
    renderHeader({ ...sample, signOut });
    await user.tab(); // logo
    const trigger = screen.getByRole('button', { name: 'User menu' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Sample User')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.keyboard(' ');
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('shows "Not signed in" with sign-out disabled when there is no user', async () => {
    const user = userEvent.setup();
    renderHeader(nobody);
    await user.click(screen.getByRole('button', { name: 'User menu' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Not signed in')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('app shell', () => {
  it('wraps the routes: header on a page and on not-found', async () => {
    for (const path of ['/', '/nope']) {
      const { unmount } = render(<RouterProvider router={createTestRouter(path)} />);
      expect(await screen.findByRole('banner')).toBeInTheDocument();
      expect(screen.getAllByRole('main')).toHaveLength(1);
      unmount();
    }
  });
});
