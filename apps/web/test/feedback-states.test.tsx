import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router';
import { expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { createQueryClient } from '../src/app/queryClient';
import { createTestRouter } from '../src/app/router';
import {
  ComingSoon,
  EmptyState,
  ErrorState,
  LoadingState,
  QueryState,
  Value,
} from '../src/components/feedback';

function Demo({ fn, empty }: { fn: () => Promise<string[]>; empty?: string }) {
  const query = useQuery({ queryKey: ['demo'], queryFn: fn });
  return (
    <QueryState query={query} emptyTitle={empty}>
      {(items) => (
        <ul>
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </QueryState>
  );
}

function renderDemo(fn: () => Promise<string[]>) {
  render(
    <QueryClientProvider client={createQueryClient({ retry: false })}>
      <Demo fn={fn} />
    </QueryClientProvider>,
  );
}

it('LoadingState has an accessible polite status', () => {
  render(<LoadingState label="Loading assets" />);
  const status = screen.getByRole('status');
  expect(status).toHaveAttribute('aria-live', 'polite');
  expect(status).toHaveTextContent('Loading assets');
});

it('QueryState shows loading, then content', async () => {
  renderDemo(() => Promise.resolve(['Crane 1']));
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(await screen.findByText('Crane 1')).toBeInTheDocument();
});

it('QueryState shows the empty state, with no number', async () => {
  renderDemo(() => Promise.resolve([]));
  expect(await screen.findByText('No data yet')).toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});

it('QueryState shows the error with the problem text, and retry refetches', async () => {
  const fn = vi
    .fn<() => Promise<string[]>>()
    .mockRejectedValueOnce(
      new ApiError(503, {
        type: 'about:blank',
        title: 'Unavailable',
        status: 503,
        detail: 'Down',
        correlationId: 'c-1',
      }),
    )
    .mockResolvedValue(['Back']);
  renderDemo(fn);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Service problem');
  expect(alert).toHaveTextContent('Unavailable: Down');
  expect(alert).toHaveTextContent('c-1');
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Back')).toBeInTheDocument();
  expect(fn).toHaveBeenCalledTimes(2);
});

it('renders problem text as text, never as HTML', () => {
  const evil = '<img src=x onerror=alert(1)><b>bold</b>';
  const { container } = render(
    <ErrorState error={new ApiError(500, { type: 'a', title: evil, status: 500, detail: evil })} />,
  );
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('b')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('<img');
});

it('shows Retry-After on 429', () => {
  render(<ErrorState error={new ApiError(429, undefined, 30)} onRetry={() => undefined} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Retry after 30 s');
});

it.each([
  [401, 'Sign-in needed'],
  [403, 'No access'],
  [404, 'Not found'],
  [500, 'Service problem'],
])('ErrorState for %i says %s', (status, title) => {
  render(<ErrorState error={new ApiError(status, undefined)} />);
  expect(screen.getByRole('alert')).toHaveTextContent(title);
});

it('offers no retry for 403 or 404, but does for 5xx and network errors', () => {
  const retry = () => undefined;
  const { rerender } = render(<ErrorState error={new ApiError(404, undefined)} onRetry={retry} />);
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<ErrorState error={new ApiError(403, undefined)} onRetry={retry} />);
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<ErrorState error={new TypeError('Failed to fetch')} onRetry={retry} />);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

it('Value renders "—" and never 0 for missing data, and keeps a real 0', () => {
  const { container, rerender } = render(
    <Value value={null} unit="kW" updatedAt="2026-01-01T08:30:00Z" />,
  );
  expect(container).toHaveTextContent('—');
  expect(container).toHaveTextContent('No data yet');
  expect(container).toHaveTextContent('updated 12:30'); // Asia/Dubai is UTC+4
  expect(container).not.toHaveTextContent('0 kW');
  rerender(<Value value={0} unit="kW" />);
  expect(container).toHaveTextContent('0 kW');
});

it('ComingSoon and EmptyState render', () => {
  render(
    <>
      <ComingSoon title="Weather" />
      <EmptyState message="Nothing here" />
    </>,
  );
  expect(screen.getByText('Coming later.')).toBeInTheDocument();
  expect(screen.getByText('No data yet')).toBeInTheDocument();
});

it('owned pages use the states: project, admin and not-found', async () => {
  const { unmount } = render(<RouterProvider router={createTestRouter('/projects/p1')} />);
  expect((await screen.findAllByText('No data yet')).length).toBeGreaterThan(0);
  unmount();
  const admin = render(<RouterProvider router={createTestRouter('/admin')} />);
  expect(await screen.findByText('Coming later.')).toBeInTheDocument();
  admin.unmount();
  render(<RouterProvider router={createTestRouter('/nope')} />);
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument(),
  );
});
