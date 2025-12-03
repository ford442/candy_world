import { defineConfig } from 'vite';
import path from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  plugins: [
    basicSsl(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/libopenmpt/lib/libopenmpt.js',
          dest: 'assets'
        },
        {
          src: 'node_modules/libopenmpt/lib/libopenmpt.wasm',
          dest: 'assets'
        }
      ]
    })
  ],
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
