import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { createTestRouter } from '../src/app/router';
import { Header } from '../src/app/layout';
import { useCurrentUser, type CurrentSession } from '../src/auth';

// Test data only.
const sample: CurrentSession = { user: { name: 'Sample User' }, signOut: vi.fn() };

function renderHeader(session: CurrentSession) {
  return render(
    <MemoryRouter>
      <Header session={session} />
    </MemoryRouter>,
  );
}

/** axe-core is not a direct dependency (no new deps for QA); use the copy pnpm already installed, if any. */
function findAxe(): string | null {
  const store = resolve(__dirname, '../../../node_modules/.pnpm');
  if (!existsSync(store)) return null;
  const dir = readdirSync(store).find((d) => d.startsWith('axe-core@'));
  const file = dir && join(store, dir, 'node_modules/axe-core/axe.min.js');
  return file && existsSync(file) ? file : null;
}

describe('S1-05 QA: no invented data', () => {
  it('the useCurrentUser stub returns no user and no sign-out', () => {
    expect(useCurrentUser()).toEqual({ user: null, signOut: null });
  });

  it('with no user: no initials, no digits anywhere in the header, bell has no badge', () => {
    renderHeader({ user: null, signOut: null });
    const header = screen.getByRole('banner');
    expect(header.textContent).not.toMatch(/\d/);
    expect(within(header).getByRole('button', { name: 'Notifications' }).textContent).toBe('');
    expect(within(header).getByRole('searchbox')).toBeDisabled();
    expect(within(header).getByRole('button', { name: /Search/ })).toBeDisabled();
  });

  it('every button and link in the header has an accessible name', () => {
    renderHeader(sample);
    const header = screen.getByRole('banner');
    for (const el of within(header).getAllByRole('button')) {
      expect(el).toHaveAccessibleName();
    }
    for (const el of within(header).getAllByRole('link')) {
      expect(el).toHaveAccessibleName();
    }
  });

  it('sign-out is disabled and not called when the session has no signOut', async () => {
    const user = userEvent.setup();
    renderHeader({ user: { name: 'Sample User' }, signOut: null });
    await user.click(screen.getByRole('button', { name: 'User menu' }));
    const item = await screen.findByRole('menuitem', { name: 'Sign out' });
    await user.click(item);
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });

  it('user menu opens with Space and returns focus to the trigger on Escape', async () => {
    const user = userEvent.setup();
    renderHeader(sample);
    const trigger = screen.getByRole('button', { name: 'User menu' });
    trigger.focus();
    await user.keyboard(' ');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('S1-05 QA: landmarks', () => {
  it.each(['/', '/nope', '/admin'])('exactly one banner and one main on %s', async (path) => {
    const { unmount } = render(<RouterProvider router={createTestRouter(path)} />);
    await screen.findByRole('main');
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.querySelectorAll('main main')).toHaveLength(0);
    unmount();
  });
});

describe('S1-05 QA: responsive classes (jsdom applies no CSS)', () => {
  it('header cannot grow wider than the viewport: flex row, search shrinks, labels never wrap', () => {
    renderHeader(sample);
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('flex', 'px-3');
    const search = screen.getByRole('search');
    expect(search).toHaveClass('min-w-0', 'flex-1');
    // Only the avatar name text is hidden below lg; the rest are fixed icon-size controls.
    expect(screen.getByText('Sample User', { selector: 'span.hidden' })).toHaveClass('lg:inline');
  });
});

describe('S1-05 QA: axe', () => {
  const axePath = findAxe();
  it.skipIf(!axePath)('header has no axe violations (menu closed and open)', async () => {
    const user = userEvent.setup();
    const { container } = renderHeader(sample);
    window.eval(readFileSync(axePath!, 'utf8'));
    const axe = (
      window as unknown as {
        axe: {
          run: (
            c: Element,
            o: object,
          ) => Promise<{ violations: { id: string; nodes: unknown[] }[] }>;
        };
      }
    ).axe;
    // color-contrast needs real layout; it is covered by tokens-contrast.test.ts.
    const opts = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };
    expect((await axe.run(container, opts)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'User menu' }));
    await screen.findByRole('menu');
    expect((await axe.run(document.body, opts)).violations.map((v) => v.id)).toEqual([]);
  });
});
