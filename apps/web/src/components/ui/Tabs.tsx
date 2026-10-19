import * as RadixTabs from '@radix-ui/react-tabs';
import { type ComponentProps } from 'react';
import { cn } from './cn';

export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...p }: ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn('flex gap-1 overflow-x-auto border-b border-border', className)}
      {...p}
    />
  );
}

export function TabsTrigger({ className, ...p }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'min-h-11 border-b-2 border-transparent px-4 text-sm font-medium text-fg-muted',
        'data-[state=active]:border-primary data-[state=active]:text-fg',
        className,
      )}
      {...p}
    />
  );
}

export function TabsContent({ className, ...p }: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn('py-4', className)} {...p} />;
}
