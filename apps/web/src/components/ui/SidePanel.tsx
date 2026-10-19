import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, useLayoutEffect, useRef } from 'react';

export type SidePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Tablet and desktop edge. Phones always get a bottom sheet. Default `right`. */
  side?: 'left' | 'right';
};

/** Right-hand panel from `md` up, bottom sheet on phones (docs/11). Focus is trapped; Esc closes. */
export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  side = 'right',
}: SidePanelProps) {
  // The panel is controlled and has no Trigger, so Radix cannot know the opener. Remember the
  // focused element when the panel opens (layout effects run before Radix moves focus inside).
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-fg/40" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            const el = opener.current;
            if (el?.isConnected) {
              event.preventDefault();
              el.focus();
            }
          }}
          className={[
            'fixed z-50 overflow-y-auto border-border bg-surface-raised p-4 text-fg',
            'inset-x-0 bottom-0 max-h-[85vh] rounded-t-lg border-t',
            'md:inset-y-0 md:max-h-none md:w-96 md:rounded-none md:border-t-0',
            side === 'left'
              ? 'md:right-auto md:left-0 md:border-r'
              : 'md:right-0 md:left-auto md:border-l',
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
