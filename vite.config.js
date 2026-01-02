import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
    // --- DEBUGGING SETTINGS ---
    minify: false,      // 1. Disable minification to keep variable names readable
    sourcemap: true,    // 2. Generate source maps to see original code in DevTools
    // --------------------------
    assetsInlineLimit: 0 
  },
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
