import { Link } from 'react-router';
import { type CurrentSession } from '../../auth';
import { InnovoLogo } from '../../components/brand';
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
    <header className="surface-slate flex min-h-16 items-center gap-2 border-b border-border px-3 md:gap-4 md:px-6">
      <Link
        to="/"
        aria-label="Innovo Nexus, portfolio"
        className="mr-4 inline-flex min-h-11 shrink-0 items-center gap-2 self-center rounded-md sm:mr-0 sm:gap-3"
      >
        {/* Clear space around the logo is at least the height of the "i" (about 0.8 of its height). */}
        <InnovoLogo className="h-[18px] w-auto text-fg sm:h-5 md:h-6" />
        <span className="sr-only">Innovo</span>
        <span aria-hidden="true" className="hidden h-6 w-px bg-border-strong sm:inline-block" />
        <span className="text-xs font-medium tracking-[0.18em] text-primary uppercase sm:text-sm sm:tracking-[0.2em]">
          Nexus
        </span>
      </Link>
      <GlobalSearch label={searchLabel} />
      <span className="shrink-0 rounded-full border border-border-strong px-2.5 py-0.5 text-xs font-medium tracking-wide text-fg">
        UAE
      </span>
      <NotificationBell />
      <UserMenu {...session} />
    </header>
  );
}
