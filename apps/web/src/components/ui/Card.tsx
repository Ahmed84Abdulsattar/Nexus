import { type HTMLAttributes } from 'react';
import { cn } from './cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-surface-raised p-4 text-fg shadow-card md:p-6',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn('mb-3 text-lg font-semibold tracking-tight', className)} {...props}>
      {children}
    </h2>
  );
}
