import { useRouteError } from 'react-router';

/** Shown when a route (or its lazy chunk) fails to load. */
export function RouteError() {
  const error = useRouteError();
  return (
    <main role="alert" className="mx-auto w-full max-w-2xl p-6 md:p-12">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-fg-muted">
        {error instanceof Error ? error.message : 'The page could not be loaded.'}
      </p>
    </main>
  );
}
