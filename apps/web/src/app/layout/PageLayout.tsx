import { type ReactNode, useState } from 'react';
import { Button, SidePanel } from '../../components/ui';
import { useLayoutMode } from './layoutMode';

export type PageLayoutProps = {
  /** Left list panel (for example projects or assets). Optional. */
  list?: ReactNode;
  /** Right details panel (for example info boxes or the selected asset). Optional. */
  details?: ReactNode;
  /** Centre area: the map or the page content. */
  children: ReactNode;
  listLabel?: string;
  detailsLabel?: string;
  /** Controlled state of the details drawer (mobile only). Lets a page open it when an item is selected. */
  detailsOpen?: boolean;
  onDetailsOpenChange?: (open: boolean) => void;
  /** Use `div` when the page already has a <main> (for example the dev demo). Default `main`. */
  contentAs?: 'main' | 'div';
};

/**
 * Desktop (1280+): list left, content centre, details right.
 * Tablet (768 to 1279): the list collapses to a button and opens as a left drawer; details stay on the right.
 * Mobile (under 768): content is full width; list and details open as bottom drawers from the same toolbar.
 */
export function PageLayout({
  list,
  details,
  children,
  listLabel = 'List',
  detailsLabel = 'Details',
  detailsOpen,
  onDetailsOpenChange,
  contentAs = 'main',
}: PageLayoutProps) {
  const mode = useLayoutMode();
  const [listOpen, setListOpen] = useState(false);
  const [detailsOpenState, setDetailsOpenState] = useState(false);
  const detailsIsOpen = detailsOpen ?? detailsOpenState;
  const setDetails = (open: boolean) => {
    setDetailsOpenState(open);
    onDetailsOpenChange?.(open);
  };

  const listInDrawer = mode !== 'desktop';
  const detailsInDrawer = mode === 'mobile';
  const Content = contentAs;
  const showToolbar = (list && listInDrawer) || (details && detailsInDrawer);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {showToolbar && (
        <div className="flex gap-2 border-b border-border bg-surface p-2">
          {list && listInDrawer && (
            <Button variant="secondary" aria-haspopup="dialog" onClick={() => setListOpen(true)}>
              {listLabel}
            </Button>
          )}
          {details && detailsInDrawer && (
            <Button variant="secondary" aria-haspopup="dialog" onClick={() => setDetails(true)}>
              {detailsLabel}
            </Button>
          )}
        </div>
      )}

      <div className="flex min-w-0 flex-1">
        {list && !listInDrawer && (
          <section
            aria-label={listLabel}
            className="w-72 shrink-0 overflow-y-auto border-r border-border bg-surface p-4"
          >
            {list}
          </section>
        )}

        <Content className="min-w-0 flex-1 p-4 md:p-6">{children}</Content>

        {details && !detailsInDrawer && (
          <section
            aria-label={detailsLabel}
            className="w-80 shrink-0 overflow-y-auto border-l border-border bg-surface p-4"
          >
            {details}
          </section>
        )}
      </div>

      {list && listInDrawer && (
        <SidePanel side="left" open={listOpen} onOpenChange={setListOpen} title={listLabel}>
          {list}
        </SidePanel>
      )}
      {details && detailsInDrawer && (
        <SidePanel open={detailsIsOpen} onOpenChange={setDetails} title={detailsLabel}>
          {details}
        </SidePanel>
      )}
    </div>
  );
}
