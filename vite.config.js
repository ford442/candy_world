import { defineConfig } from 'vite';

// Set modern build target so top-level await in dependencies (e.g. three/examples WebGPU helper)
// doesn't get transformed to an unsupported lower target during bundle/transpile.
export default defineConfig({
  // Use a relative base: this makes all emitted asset links relative
  // so the site can be hosted under any folder (e.g. /candy-world) and
  // index.html will reference assets like "./assets/..." instead of "/assets/...".
  base: './',
  build: {
    target: 'es2022',
    // Restrict rollup input to only the app's root index.html so Vite doesn't try to
    // analyze unrelated HTML files (like those under emsdk/tests) which can import
    // non-app modules such as loader.mjs.
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
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
    },
    // Note: we avoid excluding emsdk with a glob because esbuild/unparseable
    // external patterns can reject '**/emsdk/**' (too many wildcards). We
    // already limit dependency crawling to the root entry via `entries`, so
    // avoid further excludes here.
  },
  server: {
    // Keep Vite from serving files outside the repository root by default.
    fs: {
      strict: true
    },
    // Ignore the emsdk test folder (these are unrelated test HTML files that can
    // confuse Vite's dependency scanner and cause unresolved import errors).
    watch: {
      ignored: ['**/emsdk/**']
    }
  }
});
