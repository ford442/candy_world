// vite.config.ts - Optimized for code splitting
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  base: './',
  build: {
    target: 'es2022',
    assetsDir: './',
    
    // Manual chunking strategy
    rollupOptions: {
      input: {
        main: './index.html'
      },
      output: {
        manualChunks: {
          // Vendor chunk - third party libraries
          'vendor': ['three'],
          
          // Core functionality
          'core': [
            './src/core/init.ts',
            './src/core/input.ts',
            './src/core/config.ts',
            './src/core/cycle.ts'
          ],
          
          // Foliage systems - loaded after core
          'foliage': [
            './src/foliage/common.ts',
            './src/foliage/tree-batcher.ts',
            './src/foliage/flower-batcher.ts',
            './src/foliage/mushroom-batcher.ts',
            './src/foliage/cloud-batcher.ts'
          ],
          
          // Rendering and shaders
          'shaders': [
            './src/rendering/materials.ts',
            './src/rendering/material_types.ts',
            './src/rendering/shader-warmup.ts'
          ],
          
          // Audio system
          'audio': [
            './src/audio/audio-system.ts',
            './src/audio/beat-sync.ts',
            './src/systems/music-reactivity.ts'
          ],
          
          // Weather effects
          'weather': [
            './src/systems/weather.ts',
            './src/systems/weather.core.ts',
            './src/foliage/aurora.ts',
            './src/foliage/stars.ts'
          ],
          
          // Gameplay mechanics
          'gameplay': [
            './src/gameplay/rainbow-blaster.ts',
            './src/gameplay/jitter-mines.ts',
            './src/gameplay/harpoon-line.ts'
          ],
          
          // Visual effects
          'effects': [
            './src/foliage/impacts.ts',
            './src/foliage/ribbons.ts',
            './src/foliage/sparkle-trail.ts',
            './src/foliage/pollen.ts'
          ]
        },
        
        // Chunk naming for cache busting
        chunkFileNames: (chunkInfo) => {
          const info = chunkInfo;
          if (info.name === 'vendor') {
            return 'chunks/vendor-[hash].js';
          }
          return 'chunks/[name]-[hash].js';
        },
        
        // Asset naming
        assetFileNames: (assetInfo) => {
          const info = assetInfo;
          if (info.name?.endsWith('.wasm')) {
            return 'wasm/[name]-[hash][extname]';
          }
          if (/.(png|jpg|svg|gif)$/.test(info.name || '')) {
            return 'images/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    },
    
    // Optimize chunk size warnings
    chunkSizeWarningLimit: 500,
    
    // Minification options
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug']
      },
      mangle: {
        safari10: true
      }
    }
  },
  
  esbuild: {
    target: 'es2022'
  },
  
  optimizeDeps: {
    entries: ['./index.html'],
    esbuildOptions: {
      target: 'esnext'
    }
  },
  
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    fs: { strict: true },
    watch: { ignored: ['**/emsdk/**'] }
  },
  
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()]
  }
});
