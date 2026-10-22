import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header } from '../src/app/layout';
import { createQueryClient } from '../src/app/queryClient';
import { resetDevAuthForTests } from '../src/auth/devAuth';
import { useCurrentUser, useDevSession, useNoSession } from '../src/auth/useCurrentUser';
import { server } from '../src/test/server';

const NAMES: Record<string, string> = { admin: 'Demo Admin', viewer: 'Demo Viewer' };

function mockApi() {
  let lastAuth: string | null = null;
  server.use(
    http.post('*/v1/dev/token', async ({ request }) => {
      const { user } = (await request.json()) as { user: string };
      if (!NAMES[user]) return HttpResponse.json({ title: 'Bad Request' }, { status: 400 });
      return HttpResponse.json({
        tokenType: 'Bearer',
        accessToken: `token-for-${user}`,
        expiresIn: 3600,
        user: { key: user, name: NAMES[user] },
      });
    }),
    http.get('*/v1/me', ({ request }) => {
      lastAuth = request.headers.get('authorization');
      const user = lastAuth?.replace('Bearer token-for-', '') ?? '';
      if (!NAMES[user]) return HttpResponse.json({ title: 'Unauthorized' }, { status: 401 });
      return HttpResponse.json({
        id: '00000000-0000-4000-8000-000000000001',
        name: NAMES[user],
        email: null,
        roles: [user],
        permissions: [],
        projectScope: { all: true, projectIds: [] },
      });
    }),
  );
  return { lastAuth: () => lastAuth };
}

function Harness() {
  const session = useDevSession();
  return <Header session={session} />;
}

function renderDev() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  resetDevAuthForTests();
  sessionStorage.clear();
  vi.unstubAllEnvs();
});

describe('local dev sign-in picker', () => {
  it('is off by default: no picker, no user', () => {
    expect(useCurrentUser).toBe(useNoSession);
    expect(useCurrentUser()).toEqual({ user: null, signOut: null });
  });

  it('is on only in dev with VITE_AUTH_MODE=dev', async () => {
    vi.stubEnv('VITE_AUTH_MODE', 'dev');
    vi.resetModules();
    const mod = await import('../src/auth/useCurrentUser');
    expect(mod.useCurrentUser.name).toBe('useDevSession');
    vi.stubEnv('VITE_AUTH_MODE', 'entra');
    vi.resetModules();
    const other = await import('../src/auth/useCurrentUser');
    expect(other.useCurrentUser.name).toBe('useNoSession');
  });

  it('signs in, shows the name from /v1/me, sends the token, and signs out', async () => {
    const api = mockApi();
    const user = userEvent.setup();
    renderDev();
    const header = screen.getByRole('banner');
    expect(within(header).getByText('Not signed in')).toBeInTheDocument();

    await user.click(within(header).getByRole('button', { name: 'User menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign in as Admin' }));

    await waitFor(() => expect(within(header).getByText('Demo Admin')).toBeInTheDocument());
    expect(api.lastAuth()).toBe('Bearer token-for-admin');
    // sessionStorage keeps only the demo user's key, never the token; localStorage is untouched.
    expect(sessionStorage.getItem('nexus.devAuth.user')).toBe('admin');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('token-for');
    expect(localStorage.length).toBe(0);

    await user.click(within(header).getByRole('button', { name: 'User menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(within(header).getByText('Not signed in')).toBeInTheDocument());
    expect(sessionStorage.getItem('nexus.devAuth.user')).toBeNull();
  });

  it('shows the error when the API is not reachable', async () => {
    server.use(http.post('*/v1/dev/token', () => HttpResponse.error()));
    const user = userEvent.setup();
    renderDev();
    const header = screen.getByRole('banner');
    await user.click(within(header).getByRole('button', { name: 'User menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign in as Viewer' }));
    await user.click(within(header).getByRole('button', { name: 'User menu' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(within(header).getByText('Not signed in')).toBeInTheDocument();
  });
});
