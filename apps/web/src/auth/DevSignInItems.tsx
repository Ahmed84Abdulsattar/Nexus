import * as Menu from '@radix-ui/react-dropdown-menu';

/** Local development only: the "Sign in as ..." picker data (VITE_AUTH_MODE=dev). */
export type DevSignIn = {
  users: { key: string; label: string }[];
  /** Key of the demo user signed in now, or null. */
  current: string | null;
  signIn: (userKey: string) => void;
  /** Set when the last attempt failed (for example the API is not running). */
  error: string | null;
};

const itemClass =
  'flex min-h-11 cursor-default items-center rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-surface';

/**
 * The picker inside the user menu. Reached only through useDevSession (behind
 * `import.meta.env.DEV && VITE_AUTH_MODE === 'dev'`), so a production build drops it and its
 * strings; plugins/checkDist.ts fails the build if "Local development sign-in" is left in dist/.
 */
export function DevSignInItems({ devSignIn }: { devSignIn: DevSignIn }) {
  return (
    <>
      <Menu.Label className="px-3 py-1 text-xs text-fg-muted">Local development sign-in</Menu.Label>
      {devSignIn.users.map((u) => (
        <Menu.Item key={u.key} className={itemClass} onSelect={() => devSignIn.signIn(u.key)}>
          Sign in as {u.label}
          {devSignIn.current === u.key ? ' (current)' : ''}
        </Menu.Item>
      ))}
      {devSignIn.error ? (
        <p role="alert" className="px-3 py-2 text-xs text-fg-muted">
          {devSignIn.error}
        </p>
      ) : null}
      <Menu.Separator className="my-1 h-px bg-border" />
    </>
  );
}
