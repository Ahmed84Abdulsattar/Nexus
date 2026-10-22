import { type ReactNode } from 'react';

/** Small ring-and-dot mark, the brand device at icon size. Decorative. */
function RingMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className="size-8 shrink-0 text-fg-muted"
      fill="none"
    >
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="7" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" />
      <circle cx="16" cy="16" r="3" fill="var(--primary)" />
    </svg>
  );
}

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
    <div
      className="flex items-start gap-4 rounded-lg border border-dashed border-border-strong bg-surface-raised p-5"
      data-state="empty"
    >
      <RingMark />
      <div className="min-w-0">
        <p className="font-medium">
          <span aria-hidden="true">— </span>
          {title}
        </p>
        {message ? <p className="mt-1 text-sm text-fg-muted">{message}</p> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}
