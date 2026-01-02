import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  optimizeDeps: {
    exclude: ['three'] // Ensure Three.js internals aren't pre-bundled obscurely
  }
});
