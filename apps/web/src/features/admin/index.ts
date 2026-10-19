import { type RouteObject } from 'react-router';

/** Routes of this feature. The page is a lazy chunk. */
export const adminRoutes: RouteObject[] = [
  {
    path: 'admin/*',
    lazy: async () => ({ Component: (await import('./AdminPage')).AdminPage }),
  },
];
