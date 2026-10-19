import { type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { cn } from './cn';

/** Scrolls sideways (keyboard focusable, named) instead of breaking the page. Phones use card lists (docs/11). */
export function Table({
  className,
  label,
  ...props
}: HTMLAttributes<HTMLTableElement> & { label: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      // A scrollable region must be keyboard focusable (axe: scrollable-region-focusable).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-border"
    >
      <table className={cn('w-full border-collapse text-left text-sm', className)} {...props} />
    </div>
  );
}

export const THead = (p: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className="bg-surface text-fg-muted" {...p} />
);
export const TBody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
export const Tr = ({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('border-t border-border', className)} {...p} />
);
export const Th = ({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cn('px-3 py-2 font-medium', className)} {...p} />
);
export const Td = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('px-3 py-2', className)} {...p} />
);
