import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { meResponseSchema } from '@nexus/shared';
import { ApiError } from '../api/client';
import { createPendingClient } from '../api/queries/pendingClient';
import { devAuthStore, devSignOut, devUsers, restoreDevSession, signInAs } from './devAuth';

/** The signed-in person, as the API reports it (`GET /v1/me`, docs/10). Display only: the UI never decides access. */
export type CurrentUser = {
  name: string;
};

/** Local development only: the "Sign in as ..." picker data (VITE_AUTH_MODE=dev). */
export type DevSignIn = {
  users: { key: string; label: string }[];
  /** Key of the demo user signed in now, or null. */
  current: string | null;
  signIn: (userKey: string) => void;
  /** Set when the last attempt failed (for example the API is not running). */
  error: string | null;
};

export type CurrentSession = {
  user: CurrentUser | null;
  /** `null` while nobody is signed in. */
  signOut: (() => void) | null;
  /** Present only in local development with VITE_AUTH_MODE=dev. */
  devSignIn?: DevSignIn;
};

const NO_SESSION: CurrentSession = { user: null, signOut: null };

/** Until MSAL sign-in lands (S0-08, blocked on Entra) nobody is signed in. Never invent a name. */
export function useNoSession(): CurrentSession {
  return NO_SESSION;
}

let restoreStarted = false;

/**
 * Local development sign-in: the token comes from POST /v1/dev/token, the name from GET /v1/me.
 * The picker is a hook per build, not a runtime branch: `useCurrentUser` is bound once below.
 */
export function useDevSession(): CurrentSession {
  const state = useSyncExternalStore(devAuthStore.subscribe, devAuthStore.getSnapshot);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (restoreStarted) return;
    restoreStarted = true;
    void restoreDevSession().then(() => queryClient.invalidateQueries());
  }, [queryClient]);

  const me = useQuery({
    queryKey: ['me', state.userKey],
    enabled: state.token !== null,
    retry: false,
    // GET /v1/me (S1-10). Typed through the pending client: the generated schema keeps the /v1 prefix in its paths.
    queryFn: async () => meResponseSchema.parse((await createPendingClient().GET('/me')).data),
  });

  const signOut = useCallback(() => {
    devSignOut();
    queryClient.clear();
  }, [queryClient]);

  // An expired (1 h) or foreign token: go back to signed out rather than show a broken page.
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) signOut();
  }, [me.error, signOut]);

  const signIn = useCallback(
    (userKey: string) => {
      setError(null);
      signInAs(userKey)
        .then(() => queryClient.invalidateQueries())
        .catch((error: unknown) => {
          setError(error instanceof Error ? error.message : 'Local sign-in failed.');
        });
    },
    [queryClient],
  );

  const name = me.data ? (me.data.name ?? me.data.email ?? 'Signed in') : null;
  return {
    user: name ? { name } : null,
    signOut: state.token ? signOut : null,
    devSignIn: { users: devUsers, current: state.userKey, signIn, error },
  };
}

// A constant per build: `import.meta.env.DEV` is false in a production build, so this picks
// useNoSession and the bundler drops useDevSession, devAuth.ts and the /dev/token URL (checkDist).
export const useCurrentUser: () => CurrentSession =
  import.meta.env.DEV && import.meta.env.VITE_AUTH_MODE === 'dev' ? useDevSession : useNoSession;
