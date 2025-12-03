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
    // The default 'browserslist' target may not support top-level await.
    // By specifying the ES version and modern browser versions, we ensure
    // that top-level await is supported in the output bundle.
    // See: https://vitejs.dev/config/build-options.html#build-target
    target: ['es2022', 'chrome89', 'edge89', 'firefox89', 'safari15']
  }
});