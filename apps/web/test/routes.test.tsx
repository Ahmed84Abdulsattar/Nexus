import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { expect, it } from 'vitest';
import { createTestRouter } from '../src/app/router';

function visit(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={createTestRouter(path)} />
    </QueryClientProvider>,
  );
}

it('renders the portfolio placeholder at /', async () => {
  visit('/');
  expect(await screen.findByRole('heading', { name: 'Portfolio' })).toBeInTheDocument();
});

it('renders the project placeholder with the project id', async () => {
  visit('/projects/abc');
  expect(await screen.findByRole('heading', { name: 'Project' })).toBeInTheDocument();
  expect(screen.getByText('abc')).toBeInTheDocument();
});

it.each(['/admin', '/admin/users'])('renders the admin placeholder at %s', async (path) => {
  visit(path);
  expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
});

it.each(['/nope', '/projects', '/projects/abc/extra'])('shows not-found at %s', async (path) => {
  visit(path);
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
});
