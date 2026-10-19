import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router';
import { NotFound, PageLoading, RouteError } from '../components/feedback';
import { adminRoutes } from '../features/admin';
import { devRoutes } from '../features/dev';
import { portfolioRoutes } from '../features/portfolio';
import { projectRoutes } from '../features/project';
import { AppShell } from './layout';

/** Only the three backlog routes. Other routes arrive with their features (docs/05). */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    hydrateFallbackElement: <PageLoading />,
    children: [
      {
        // Inside the shell, so the header stays visible when a page fails.
        errorElement: <RouteError />,
        children: [
          ...portfolioRoutes,
          ...projectRoutes,
          ...adminRoutes,
          ...(import.meta.env.DEV ? devRoutes : []),
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (path: string) =>
  createMemoryRouter(routes, { initialEntries: [path] });
