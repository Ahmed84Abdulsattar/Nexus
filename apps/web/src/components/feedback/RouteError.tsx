import { useRouteError } from 'react-router';

/** Shown when a route (or its lazy chunk) fails to load. */
export function RouteError() {
  const error = useRouteError();
  return (
    <main role="alert" className="p-6">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p>{error instanceof Error ? error.message : 'The page could not be loaded.'}</p>
    </main>
  );
}
