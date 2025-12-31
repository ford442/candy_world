// vite.config.js
import { defineConfig } from 'vite';
export default defineConfig({
  base: './', // <--- CRITICAL for hosting in a folder like /candy-world/
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }
  },
  worker: {
    format: 'es'
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
});
