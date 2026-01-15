// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    // Ensures assets don't get lost in complex folder structures
    assetsDir: './',
  },
  server: {
    headers: {
      // These headers are REQUIRED for SharedArrayBuffer (Pthreads)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }
  },
  // Ensure the worker file is treated correctly if using Vite's worker import (optional but safe)
  worker: {
    format: 'es'
  }
});
