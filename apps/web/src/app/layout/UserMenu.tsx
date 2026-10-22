import * as Menu from '@radix-ui/react-dropdown-menu';
import { type CurrentSession } from '../../auth';

/** Up to two initials from a real name. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

const itemClass =
  'flex min-h-11 cursor-default items-center rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-selected data-[disabled]:cursor-not-allowed data-[disabled]:text-fg-muted';

/** Name and sign-out. With no user it shows "Not signed in" and sign-out is disabled. */
export function UserMenu({ user, signOut, devMenu }: CurrentSession) {
  const name = user?.name ?? null;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="User menu"
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full pr-0 text-sm font-medium hover:bg-surface lg:justify-start lg:pr-3"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-fg"
        >
          {name ? (
            initials(name)
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
          )}
        </span>
        <span className="hidden max-w-40 truncate lg:inline">{name ?? 'Not signed in'}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-48 rounded-lg border border-border bg-surface-raised p-1 text-fg shadow-pop"
        >
          <Menu.Label className="px-3 py-2 text-sm font-medium">
            {name ?? 'Not signed in'}
          </Menu.Label>
          <Menu.Separator className="my-1 h-px bg-border" />
          {devMenu}
          <Menu.Item className={itemClass} disabled={!signOut} onSelect={() => signOut?.()}>
            Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
