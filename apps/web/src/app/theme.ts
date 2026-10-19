export type Theme = 'light' | 'dark';
const KEY = 'nexus.theme';

/** Stored choice, else the OS preference. */
export function initialTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem(KEY, theme);
}
