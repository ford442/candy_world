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
          // GPU compute modules - isolated, heavy
          if (id.includes('/src/compute/')) {
            return 'compute';
          }
          // Audio system and music reactivity
          if (id.includes('/src/audio/')) {
            return 'audio';
          }
          // Gameplay mechanics (weapons, abilities)
          if (id.includes('/src/gameplay/')) {
            return 'gameplay';
          }
          // Weather system and effects
          if (id.includes('/src/systems/weather/')) {
            return 'weather';
          }
          // UI modules
          if (id.includes('/src/ui/')) {
            return 'ui';
          }
          // Utility modules (WASM loaders, profilers)
          if (id.includes('/src/utils/')) {
            return 'utils';
          }
          // Foliage - large module set
          if (id.includes('/src/foliage/')) {
            return 'foliage';
          }
          // Workers
          if (id.includes('/src/workers/')) {
            return 'workers';
          }
          // World generation
          if (id.includes('/src/world/')) {
            return 'world';
          }
          // Remaining systems (physics, discovery, etc.) stay in main
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
    // inside emsdk or other bundles which can include non-app imports.
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
