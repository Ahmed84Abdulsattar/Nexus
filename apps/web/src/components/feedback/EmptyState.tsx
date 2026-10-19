import { type ReactNode } from 'react';

/** "No data yet". Never shows a number: missing data is not zero. */
export function EmptyState({
  title = 'No data yet',
  message,
  action,
}: {
  title?: string;
  message?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-border-strong p-4" data-state="empty">
      <p className="font-medium">
        <span aria-hidden="true">— </span>
        {title}
      </p>
      {message ? <p className="mt-1 text-sm text-fg-muted">{message}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
