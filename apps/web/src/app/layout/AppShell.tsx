import { Outlet } from 'react-router';
import { useCurrentUser } from '../../auth';
import { Header } from './Header';

/** App frame on every page. Pages render their own <main>. */
export function AppShell() {
  const session = useCurrentUser();
  return (
    <div className="flex min-h-dvh flex-col">
      <Header session={session} />
      <Outlet />
    </div>
  );
}
