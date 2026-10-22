import { DEV_USERS, devTokenResponseSchema, type DevTokenResponse } from '@nexus/shared';
import { resolveApiBase, setAccessTokenProvider } from '../api/client';

/**
 * Local development sign-in (docs/08 "Local development sign-in"). This file is reached only behind
 * `import.meta.env.DEV && VITE_AUTH_MODE === 'dev'` (see useCurrentUser.ts), so a production build
 * drops it, and plugins/checkDist.ts fails the build if any of it is left in dist/.
 *
 * Storage: the access token is kept in memory only (this module's variable). `sessionStorage` holds
 * just the chosen demo user's key, so a page reload signs in as the same demo user again by asking
 * the API for a new token. Nothing is written to localStorage.
 */
export const DEV_AUTH_STORAGE_KEY = 'nexus.devAuth.user';

export interface DevAuthState {
  /** Key of the demo user, or null when signed out. */
  userKey: string | null;
  /** In memory only. */
  token: string | null;
}

let state: DevAuthState = { userKey: null, token: null };
const listeners = new Set<() => void>();

function set(next: DevAuthState): void {
  state = next;
  setAccessTokenProvider(() => Promise.resolve(next.token ?? undefined));
  for (const listener of listeners) listener();
}

export const devAuthStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: (): DevAuthState => state,
};

export const devUsers = DEV_USERS.map((u) => ({ key: u.key, label: u.label }));

/** Asks the local API for a token for a demo user. Rejects with the API's message on failure. */
export async function requestDevToken(userKey: string): Promise<DevTokenResponse> {
  const url = `${resolveApiBase().href.replace(/\/$/, '')}/dev/token`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: userKey }),
  });
  if (!response.ok) {
    throw new Error(
      `Local sign-in failed (${response.status}). Is the API running with AUTH_MODE=dev?`,
    );
  }
  return devTokenResponseSchema.parse(await response.json());
}

export async function signInAs(userKey: string): Promise<void> {
  const token = await requestDevToken(userKey);
  sessionStorage.setItem(DEV_AUTH_STORAGE_KEY, token.user.key);
  set({ userKey: token.user.key, token: token.accessToken });
}

export function devSignOut(): void {
  sessionStorage.removeItem(DEV_AUTH_STORAGE_KEY);
  set({ userKey: null, token: null });
}

/** After a reload: sign in again as the remembered demo user, if there is one. */
export async function restoreDevSession(): Promise<void> {
  const remembered = sessionStorage.getItem(DEV_AUTH_STORAGE_KEY);
  if (remembered && state.token === null) {
    try {
      await signInAs(remembered);
    } catch {
      sessionStorage.removeItem(DEV_AUTH_STORAGE_KEY);
    }
  }
}

/** Test helper: back to signed out without touching storage. */
export function resetDevAuthForTests(): void {
  set({ userKey: null, token: null });
}
