import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/** Starts the MSW service worker. Called from main.tsx only when `import.meta.env.DEV`. */
export async function startMockWorker(): Promise<void> {
  await setupWorker(...handlers).start({ onUnhandledFrame: 'bypass', quiet: true });
}
