import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/tailwind.css';
import { applyTheme, initialTheme } from './app/theme';

applyTheme(initialTheme(), false);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

async function start(rootElement: HTMLElement) {
  // Dev only: MSW answers /v1/config and /v1/projects until the API serves them (S1-02, S1-04).
  // `import.meta.env.DEV` is false in a build, so this branch, MSW and the sample data are dropped.
  if (import.meta.env.DEV) {
    try {
      const { startMockWorker } = await import('./test/browser');
      await startMockWorker();
    } catch (error) {
      // The app still renders; requests then go to the real API base, which may not exist yet.
      console.warn('Dev mock API (MSW) could not start:', error);
    }
  }
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start(root);
