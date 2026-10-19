import { describeError, type ErrorView } from '../../api/errors';
import { Button } from '../ui';

function isErrorView(value: unknown): value is ErrorView {
  return typeof value === 'object' && value !== null && 'kind' in value && 'message' in value;
}

/**
 * Error with a retry button. All text is rendered as React text (escaped), never as HTML.
 * Accepts the thrown value or an already described `ErrorView`.
 */
export function ErrorState({
  error,
  onRetry,
  retrying = false,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const view = isErrorView(error) ? error : describeError(error);
  // Retrying a 403 or 404 cannot help; the user needs access or a different link.
  const showRetry = onRetry && view.kind !== 'forbidden' && view.kind !== 'not-found';
  return (
    <div
      role="alert"
      className="rounded-md border border-border-strong bg-surface p-4"
      data-state="error"
    >
      <p className="font-semibold">
        <span aria-hidden="true">! </span>
        {view.title}
      </p>
      <p className="mt-1 text-sm">{view.message}</p>
      {view.problemTitle || view.problemDetail ? (
        <p className="mt-1 text-sm text-fg-muted">
          {[view.problemTitle, view.problemDetail].filter(Boolean).join(': ')}
        </p>
      ) : null}
      {view.correlationId ? (
        <p className="mt-1 text-xs text-fg-muted">Reference: {view.correlationId}</p>
      ) : null}
      {showRetry ? (
        <div className="mt-3">
          <Button variant="secondary" onClick={onRetry} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Try again'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
