import { type ReactNode } from 'react';
import { cn } from './cn';

/**
 * Page title block: a small label above the h1, an optional line of context and optional actions.
 * Text comes from the page (props); this component holds no copy.
 */
export function PageHeading({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-fg-muted uppercase">
            <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-prose text-sm text-fg-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
