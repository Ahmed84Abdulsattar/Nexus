import { Link } from 'react-router';
import { type CurrentSession } from '../../auth';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';

/**
 * Top bar from the mockup: logo, search, UAE label, bell, avatar.
 * `searchLabel` names the search landmark; a second header on one page (the dev components page)
 * needs a different name so landmarks stay unique.
 */
export function Header({
  session,
  searchLabel,
}: {
  session: CurrentSession;
  searchLabel?: string;
}) {
  return (
    <header className="flex items-center gap-2 border-b border-border bg-surface-raised px-3 md:gap-4 md:px-6">
      <Link
        to="/"
        aria-label="Innovo Nexus, portfolio"
        className="inline-flex min-h-11 shrink-0 items-baseline gap-1 self-center rounded-md"
      >
        <span className="text-lg font-bold tracking-tight">Innovo</span>
        <span className="text-lg font-light text-primary">Nexus</span>
      </Link>
      <GlobalSearch label={searchLabel} />
      <span className="shrink-0 text-sm font-medium text-fg-muted">UAE</span>
      <NotificationBell />
      <UserMenu {...session} />
    </header>
  );
}
