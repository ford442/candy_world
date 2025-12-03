import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    basicSsl(),
    viteStaticCopy({
      targets: [
        {
          src: 'mod-player/libopenmpt.js',
          dest: 'mod-player'
        }
      ]
    })
  ],
  build: {
    target: 'esnext'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});