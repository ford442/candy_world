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
  },
  esbuild: {
    // ensure esbuild treats code as modern so top-level await is preserved
    target: 'es2022'
  }
});
