import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    basicSsl()
  ],
  esbuild: {
    target: 'esnext'
  },
  build: {
    target: 'esnext'
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  },
  ssr: {
    target: 'esnext'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});