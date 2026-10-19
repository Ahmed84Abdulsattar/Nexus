import { useSyncExternalStore } from 'react';

/** Widths in px; they match the Tailwind `md` (768) and `xl` (1280) breakpoints (docs/11). */
export const TABLET_MIN = 768;
export const DESKTOP_MIN = 1280;

export type LayoutMode = 'mobile' | 'tablet' | 'desktop';

/** Pure rule: below 768 mobile, 768 to 1279 tablet, 1280 and up desktop. */
export function layoutModeForWidth(width: number): LayoutMode {
  if (width >= DESKTOP_MIN) return 'desktop';
  if (width >= TABLET_MIN) return 'tablet';
  return 'mobile';
}

const tabletQuery = `(min-width: ${TABLET_MIN}px)`;
const desktopQuery = `(min-width: ${DESKTOP_MIN}px)`;

const hasMatchMedia = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function read(): LayoutMode {
  // No matchMedia (for example jsdom): treat as desktop so all panels render inline.
  if (!hasMatchMedia()) return 'desktop';
  if (window.matchMedia(desktopQuery).matches) return 'desktop';
  if (window.matchMedia(tabletQuery).matches) return 'tablet';
  return 'mobile';
}

function subscribe(onChange: () => void) {
  if (!hasMatchMedia()) return () => {};
  const lists = [window.matchMedia(tabletQuery), window.matchMedia(desktopQuery)];
  lists.forEach((l) => l.addEventListener('change', onChange));
  return () => lists.forEach((l) => l.removeEventListener('change', onChange));
}

/** Current layout mode, updated when the window crosses a breakpoint. */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, read, () => 'desktop');
}
