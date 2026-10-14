import { useQuery } from '@tanstack/react-query';
import { getHealthLive } from '../../api/health';
import { ComingSoon, QueryState, Value } from '../../components/feedback';

/**
 * Dev-only. Shows loading, empty, error (with retry) and content for a real query through the
 * generated client, using GET /health/live (the only endpoint that exists today). It shows no
 * invented data: tests and e2e force each state by intercepting that request.
 */
export function StatesPage() {
  const query = useQuery({
    queryKey: ['dev', 'health-live'],
    queryFn: async () => (await getHealthLive()) ?? null, // TanStack Query forbids undefined data
  });
  return (
    <main className="mx-auto w-full max-w-3xl min-w-0 space-y-6 p-4 md:p-6">
      <h1 className="text-2xl font-semibold">States</h1>
      <section aria-labelledby="health-heading" className="space-y-2">
        <h2 id="health-heading" className="text-lg font-medium">
          API health
        </h2>
        <QueryState
          query={query}
          loadingLabel="Loading API health"
          emptyMessage="The API answered without a body."
        >
          {(data) => (
            <p>
              Status:{' '}
              <Value value={data.status} updatedAt={new Date(query.dataUpdatedAt).toISOString()} />
            </p>
          )}
        </QueryState>
      </section>
      <section aria-labelledby="missing-heading" className="space-y-2">
        <h2 id="missing-heading" className="text-lg font-medium">
          Missing value
        </h2>
        <p>
          Power: <Value value={null} unit="kW" />
        </p>
      </section>
      <ComingSoon title="Weather" />
    </main>
  );
}
