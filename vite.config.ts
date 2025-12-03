import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    // Enables HTTPS for local development, useful for WebXR, etc.
    basicSsl(),
    // Copies static assets to the build directory.
    // You'll need to configure this based on your project structure.
    // For example, to copy a 'models' folder:
    viteStaticCopy({
      targets: [
        {
          src: 'src/assets/models/*',
          dest: 'models'
        }
      ]
    })
  ],
  build: {
    // Set the target to a modern environment that supports top-level await.
    target: 'es2022'
  }
});