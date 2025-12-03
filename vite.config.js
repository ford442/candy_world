import { defineConfig } from 'vite';

// Set modern build target so top-level await in dependencies (e.g. three/examples WebGPU helper)
// doesn't get transformed to an unsupported lower target during bundle/transpile.
export default defineConfig({
  build: {
    target: 'es2022',
  },
  esbuild: {
    // ensure esbuild treats code as modern so top-level await is preserved
    target: 'es2022'
  }
});
