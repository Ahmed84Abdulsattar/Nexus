import { type ReactNode } from 'react';
import { cn } from './cn';

export type InfoBoxProps = {
  title: string;
  /** Freshness text from the API, already formatted (for example "14:32"). `null` = no data yet. */
  updated: string | null;
  /** From the API (`stale: true`). The frontend never works this out. */
  stale?: boolean;
  /** `undefined`/`null` renders "—", never 0. */
  children?: ReactNode;
  className?: string;
};

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4v4l2.5 1.5" />
    </svg>
  );
}

/** Live-data box. Always shows freshness; stale shows a clock icon, the word "Stale" and muted text. */
export function InfoBox({ title, updated, stale, children, className }: InfoBoxProps) {
  const empty = children === undefined || children === null || children === '';
  return (
    <section
      aria-label={title}
      data-stale={stale ? 'true' : undefined}
      className={cn(
        'rounded-lg border border-border bg-surface-raised p-4',
        stale ? 'text-fg-muted' : 'text-fg',
        className,
      )}
    >
      <h3 className="text-sm font-medium text-fg-muted">{title}</h3>
      <div className="my-2 text-2xl font-semibold">{empty ? '—' : children}</div>
      <p className="flex items-center gap-1 text-xs text-fg-muted">
        {stale && <ClockIcon />}
        {stale && <span className="font-medium">Stale.</span>}
        {updated === null ? 'no data yet' : `updated ${updated}`}
      </p>
    </section>
  );
}
