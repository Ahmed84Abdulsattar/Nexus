import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode } from 'react';

export type SidePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
};

/** Right-hand panel from `md` up, bottom sheet on phones (docs/11). Focus is trapped; Esc closes. */
export function SidePanel({ open, onOpenChange, title, description, children }: SidePanelProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-fg/40" />
        <Dialog.Content
          className={[
            'fixed z-50 overflow-y-auto border-border bg-surface-raised p-4 text-fg',
            'inset-x-0 bottom-0 max-h-[85vh] rounded-t-lg border-t',
            'md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-96 md:rounded-none md:border-t-0 md:border-l',
          ].join(' ')}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border-strong"
            >
              <span aria-hidden="true">×</span>
            </Dialog.Close>
          </div>
          <Dialog.Description className={description ? 'mb-3 text-sm text-fg-muted' : 'sr-only'}>
            {description ?? title}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
