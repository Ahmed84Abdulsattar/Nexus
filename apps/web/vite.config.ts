import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { msw } from 'msw/vite';
import { defineConfig, loadEnv } from 'vite';
import { checkDist } from './plugins/checkDist';
import { assertWebEnv } from './plugins/envGuards';

// The repo-root .env (git-ignored) holds the developer's values, as .env.example at the root shows.
const envDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ command, mode }) => {
  // The dev ArcGIS key never reaches a build; the key reaches the browser only from GET /v1/config.
  // Names are checked against an allow-list and values are never printed.
  assertWebEnv({
    command,
    nodeEnv: process.env['NODE_ENV'],
    env: loadEnv(mode, envDir, 'VITE_'),
  });

  return {
    envDir,
    plugins: [
      react(),
      tailwindcss(),
      // Serves /mockServiceWorker.js in dev only; it would otherwise be copied into dist/.
      ...(command === 'serve' ? [msw({ mode: 'worker-only' })] : []),
      checkDist(),
    ],
    // Bind to localhost only, so the dev server (and its mock key) is not reachable from the LAN.
    server: { host: 'localhost', port: 5173, strictPort: true },
    build: {
      // The SDK ships as ~1,000 small lazy chunks (one 15 MB chunk would be 4 MB gzipped, over the
      // 2 MB budget). They are written under assets/arcgis/ so plugins/checkDist.ts and the CDN
      // rules can tell them apart. Nothing outside the lazy map adapter imports them.
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
