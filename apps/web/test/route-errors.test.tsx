import { render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestRouter } from '../src/app/router';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../src/features/project/ProjectPage');
  vi.restoreAllMocks();
});

it('shows the route error page when a lazy chunk fails to load', async () => {
  vi.doMock('../src/features/project/ProjectPage', () => {
    throw new Error('Failed to fetch dynamically imported module');
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { createTestRouter: fresh } = await import('../src/app/router');
  render(<RouterProvider router={fresh('/projects/abc')} />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Something went wrong');
  expect(screen.queryByRole('heading', { name: 'Project' })).not.toBeInTheDocument();
});

it('shows the route error page when a page throws while rendering', async () => {
  vi.doMock('../src/features/project/ProjectPage', () => ({
    ProjectPage: () => {
      throw new Error('boom');
    },
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { createTestRouter: fresh } = await import('../src/app/router');
  render(<RouterProvider router={fresh('/projects/abc')} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('boom');
});

it('deep links work: nested admin path', async () => {
  render(<RouterProvider router={createTestRouter('/admin/users/42/edit')} />);
  expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
});

it('decodes the project id from the URL', async () => {
  render(<RouterProvider router={createTestRouter('/projects/a%20b')} />);
  expect(await screen.findByText('a b')).toBeInTheDocument();
});

it('the jsdom Request patch keeps method, headers and body, and only drops the signal', async () => {
  const req = new Request('http://x.test/a', {
    method: 'POST',
    headers: { 'x-a': '1' },
    body: 'hi',
    signal: new AbortController().signal,
  });
  expect(req.method).toBe('POST');
  expect(req.headers.get('x-a')).toBe('1');
  expect(await req.text()).toBe('hi');
});
