import { Slot } from '@radix-ui/react-slot';
import { type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Render the child element (for example a router Link) with button styling. */
  asChild?: boolean;
};

const variants = {
  primary: 'bg-primary text-primary-fg border-transparent shadow-card hover:bg-primary-hover',
  secondary: 'bg-surface-raised text-fg border-border-strong shadow-card hover:bg-surface',
  ghost: 'bg-transparent text-fg border-transparent hover:bg-surface',
} as const;

export function Button({
  variant = 'primary',
  asChild,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      type={asChild ? undefined : type}
      className={cn(
        'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
