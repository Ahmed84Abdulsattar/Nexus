import { type RouteObject } from 'react-router';

/** Dev-only routes. Registered in router.tsx behind `import.meta.env.DEV`, so no production chunk. */
export const devRoutes: RouteObject[] = [
  {
    path: 'dev/components',
    lazy: async () => ({ Component: (await import('./ComponentsPage')).ComponentsPage }),
  },
  {
    path: 'dev/states',
    lazy: async () => ({ Component: (await import('./StatesPage')).StatesPage }),
  },
];
