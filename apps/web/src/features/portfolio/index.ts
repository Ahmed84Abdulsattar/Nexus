import { type RouteObject } from 'react-router';

/** Routes of this feature. The page is a lazy chunk. */
export const portfolioRoutes: RouteObject[] = [
  {
    index: true,
    lazy: async () => ({ Component: (await import('./PortfolioPage')).PortfolioPage }),
  },
];
