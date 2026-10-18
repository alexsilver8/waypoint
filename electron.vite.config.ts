import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // Runs in a separate utility process; see src/main/extensions/host-client.ts.
          'extension-host': resolve('src/extension-host/index.ts'),
          // @waypoint-org/api, for extensions that use it without installing it; see src/extension-host/api.ts.
          'waypoint-api': resolve('packages/api/src/index.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        // Sandboxed preloads can't load other files, so the entries must not share any
        // runtime module (type-only imports are fine). Check out/preload has no chunks.

        input: {
          index: resolve('src/preload/index.ts'),
          notes: resolve('src/preload/notes.ts'),
          settings: resolve('src/preload/settings.ts'),
          onboarding: resolve('src/preload/onboarding.ts'),
        },
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      minify: true,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          notes: resolve('src/renderer/notes.html'),
          settings: resolve('src/renderer/settings.html'),
          onboarding: resolve('src/renderer/onboarding.html'),
        },
      },
    },
    plugins: [react()],
  },
});
