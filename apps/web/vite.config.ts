import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { msw } from 'msw/vite';
import { defineConfig, loadEnv } from 'vite';

// The repo-root .env (git-ignored) holds the developer's values, as .env.example at the root shows.
const envDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ command, mode }) => {
  // S0-07 acceptance: a build never carries the interim dev ArcGIS key. The key reaches the
  // browser only from GET /v1/config (docs/sprints/S0.md section 5). The value is never printed.
  if (command === 'build' && loadEnv(mode, envDir, 'VITE_DEV_')['VITE_DEV_ARCGIS_API_KEY']) {
    throw new Error(
      'VITE_DEV_ARCGIS_API_KEY is set. It is for local development only and must be empty for a build.',
    );
  }

  return {
    envDir,
    plugins: [
      react(),
      tailwindcss(),
      // Serves /mockServiceWorker.js in dev only; it would otherwise be copied into dist/.
      ...(command === 'serve' ? [msw({ mode: 'worker-only' })] : []),
    ],
    server: { port: 5173, strictPort: true },
    build: {
      // The SDK ships as ~1,100 small lazy chunks (one 15 MB chunk would be 4 MB gzipped, over the
      // 2 MB budget). They are all written under assets/arcgis/ so scripts/check-dist.mjs and the
      // CDN rules can tell them apart. Nothing outside the lazy map adapter imports them.
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          chunkFileNames: (chunk) =>
            chunk.moduleIds.some((id) =>
              id.replaceAll('\\', '/').includes('/node_modules/@arcgis/'),
            )
              ? 'assets/arcgis/[name]-[hash].js'
              : 'assets/[name]-[hash].js',
        },
      },
    },
  };
});
