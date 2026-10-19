import { type ReactNode } from 'react';

/** App-wide providers. Query, auth and live providers are added by their tasks (S0-08, S1-xx). */
export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
