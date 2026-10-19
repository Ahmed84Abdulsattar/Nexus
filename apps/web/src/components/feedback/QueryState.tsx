import { type UseQueryResult } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

function defaultIsEmpty(data: unknown): boolean {
  return data === null || data === undefined || (Array.isArray(data) && data.length === 0);
}

/**
 * Renders a TanStack Query result as loading, error (with retry), empty, or the content.
 * A failed query shows the error even if older data exists, so a failure is never hidden.
 */
export function QueryState<T>({
  query,
  children,
  isEmpty = defaultIsEmpty,
  loadingLabel,
  emptyTitle,
  emptyMessage,
}: {
  query: Pick<UseQueryResult<T>, 'status' | 'error' | 'refetch' | 'isFetching'> & {
    data: T | undefined;
  };
  children: (data: NonNullable<T>) => ReactNode;
  isEmpty?: (data: NonNullable<T>) => boolean;
  loadingLabel?: string;
  emptyTitle?: string;
  emptyMessage?: string;
}) {
  if (query.status === 'pending') return <LoadingState label={loadingLabel} />;
  if (query.status === 'error') {
    return (
      <ErrorState
        error={query.error}
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const data = query.data;
  if (data === undefined || data === null || isEmpty(data)) {
    return <EmptyState title={emptyTitle} message={emptyMessage} />;
  }
  return <>{children(data)}</>;
}
