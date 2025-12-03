import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
  ,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three-vendor';
          if (id.includes('node_modules')) return 'vendor';
          if (id.includes('/src/foliage/')) return 'foliage';
          if (id.includes('/src/audio-system')) return 'audio';
          return undefined;
        }
      }
    }
  }
});
