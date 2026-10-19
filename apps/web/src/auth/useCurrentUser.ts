/** The signed-in person, as the API reports it (`GET /v1/me`, docs/10). Display only: the UI never decides access. */
export type CurrentUser = {
  name: string;
};

export type CurrentSession = {
  user: CurrentUser | null;
  /** `null` while nobody is signed in. */
  signOut: (() => void) | null;
};

/**
 * TODO(S0-08): replace this stub with MSAL sign-in and `GET /v1/me`. Entra is not available yet, so
 * there is no user and nothing to sign out of. Never put a fake name here; tests pass a sample user.
 */
export function useCurrentUser(): CurrentSession {
  return { user: null, signOut: null };
}
