// vite.config.js
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// Set modern build target so top-level await in dependencies (e.g. three/examples WebGPU helper)
// doesn't get transformed to an unsupported lower target during bundle/transpile.
export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait()
  ],
  base: './',
  build: {
    sourcemap: true,
    minify: true,
    target: 'es2022',
    // Ensures assets don't get lost in complex folder structures
    assetsDir: './',
    // Restrict rollup input to only the app's root index.html so Vite doesn't try to
    // analyze unrelated HTML files (like those under emsdk/tests) which can import
    // non-app modules such as loader.mjs.
    rollupOptions: {
      input: {
        main: './index.html'
      },
      output: {
        manualChunks(id) {
          // Vendor chunk - all third-party dependencies
          if (id.includes('node_modules')) {
            return 'vendor';
          }
          // NOTE: /src/compute/ stays in `app` — it is statically imported from
          // deferred-init / weather / culling, and a separate compute chunk
          // creates Circular chunk: compute ↔ app (undefined live bindings).
          // Audio system (music reactivity stays in app — shared with foliage)
          if (id.includes('/src/audio/')) {
            return 'audio';
          }
          // Workers
          if (id.includes('/src/workers/')) {
            return 'workers';
          }

          // --- Lazy chunks (#1361): only reached via dynamic import() ---
          // Thin *lazy.ts stubs stay in `app` (statically imported); the heavy
          // modules below are loaded via import() from those stubs.
          // Gameplay abilities (blaster, mines, chord, harpoon, glitch grenade)
          if (
            (id.includes('/src/gameplay/') && !id.endsWith('/gameplay/lazy.ts')) ||
            id.includes('/src/systems/glitch-grenade.ts')
          ) {
            return 'gameplay';
          }
          // Save menu UI (exclude thin lazy stub)
          if (
            id.includes('/src/ui/save-menu/') &&
            !id.endsWith('/save-menu/lazy.ts')
          ) {
            return 'save-ui';
          }
          // Analytics debug overlay (?debug=1 / /stats) — not the *-lazy stub
          if (
            id.includes('/src/ui/analytics-debug.ts') ||
            id.includes('/src/ui/analytics-debug-ui.ts') ||
            id.includes('/src/ui/analytics-debug-handlers.ts')
          ) {
            return 'analytics-debug';
          }
          // World content decorators (procedural extras, gem canopy, mycelium)
          if (id.includes('/src/world/generation-decorators.ts')) {
            return 'world-content';
          }

          // Remaining app code with intertwined imports stays in one chunk to
          // avoid circular *chunk* dependencies (foliage ↔ systems core, etc.).
          if (
            id.includes('/src/core/') ||
            id.includes('/src/foliage/') ||
            id.includes('/src/particles/') ||
            id.includes('/src/rendering/') ||
            id.includes('/src/systems/') ||
            id.includes('/src/ui/') ||
            id.includes('/src/utils/') ||
            id.includes('/src/world/') ||
            id.includes('/src/debug/') ||
            id.includes('/src/compute/')
          ) {
            return 'app';
          }
          // Remaining modules stay in main
        },
        chunkFileNames: (chunkInfo) => {
          const prefix = chunkInfo.name === 'vendor' ? 'chunks/vendor' : 'chunks/[name]';
          return `${prefix}-[hash].js`;
        },
        assetFileNames: (assetInfo) => {
          const info = assetInfo;
          if (info.name?.endsWith('.wasm')) {
            return 'wasm/[name]-[hash][extname]';
          }
          if (/\.(png|jpg|svg|gif|webp)$/.test(info.name || '')) {
            return 'images/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    },
    // Optimize chunk size warnings
    chunkSizeWarningLimit: 500
  },
  esbuild: {
    // ensure esbuild treats code as modern so top-level await is preserved
    target: 'es2022'
  },
  // Ensure optimizeDeps only scans the app root entry (index.html) and targets
  // modern JS (esnext) so top-level await in dependencies is preserved.
  optimizeDeps: {
    // Force dependency scanning to the app's root index -- don't scan test HTML files
    // inside emsdk or other bundles which can include non-app modules such as loader.mjs.
    entries: ['./index.html'],
    esbuildOptions: {
      target: 'esnext'
    }
  },
  server: {
    headers: {
      // These headers are REQUIRED for SharedArrayBuffer (Pthreads)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // Keep Vite from serving files outside the repository root by default.
    fs: {
      strict: true
    },
    // Ignore the emsdk test folder (these are unrelated test HTML files that can
    // confuse Vite's dependency scanner and cause unresolved import errors).
    watch: {
      ignored: ['**/emsdk/**']
    }
  },
  // Ensure the worker file is treated correctly if using Vite's worker import (optional but safe)
  worker: {
    format: 'es',
    plugins: () => [
      wasm(),
      topLevelAwait()
    ]
  }
});
