import { type RouteObject } from 'react-router';

/** Routes of this feature. The page is a lazy chunk. */
export const projectRoutes: RouteObject[] = [
  {
    path: 'projects/:projectId',
    lazy: async () => ({ Component: (await import('./ProjectPage')).ProjectPage }),
  },
];
