#!/usr/bin/env tsx
/**
 * Code Splitting Strategy for candy_world
 * 
 * Generates intelligent chunking recommendations
 * Creates prefetch/preload hints for critical paths
 * Implements dynamic imports for optional features
 * 
 * Usage: tsx code-splitting-strategy.ts [--output ./stats/code-splitting-plan.md]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const STATS_DIR = path.join(__dirname, '../stats');
const OUTPUT_FILE = path.join(STATS_DIR, 'code-splitting-plan.md');

interface ChunkStrategy {
  name: string;
  description: string;
  files: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  preloadStrategy: 'immediate' | 'lazy' | 'interaction' | 'idle';
  estimatedSize: number;
  dependencies: string[];
}

interface DynamicImport {
  feature: string;
  currentImport: string;
  proposedImport: string;
  trigger: string;
  estimatedSavings: number;
}

interface PreloadHint {
  resource: string;
  as: 'script' | 'style' | 'image' | 'fetch' | 'font';
  type: 'preload' | 'prefetch' | 'modulepreload';
  condition: string;
}

interface SplittingPlan {
  chunks: ChunkStrategy[];
  dynamicImports: DynamicImport[];
  preloadHints: PreloadHint[];
  implementation: {
    viteConfig: string;
    dynamicImportExamples: Record<string, string>;
    htmlPreloads: string;
  };
}

class CodeSplittingStrategy {
  private plan: SplittingPlan = {
    chunks: [],
    dynamicImports: [],
    preloadHints: [],
    implementation: {
      viteConfig: '',
      dynamicImportExamples: {},
      htmlPreloads: ''
    }
  };

  async analyze(): Promise<SplittingPlan> {
    console.log('✂️ Analyzing code splitting opportunities...');
    
    // Analyze source structure
    await this.analyzeSourceStructure();
    
    // Define chunk strategies
    this.defineChunkStrategies();
    
    // Identify dynamic import opportunities
    this.identifyDynamicImports();
    
    // Generate preload hints
    this.generatePreloadHints();
    
    // Generate implementation code
    this.generateImplementation();
    
    return this.plan;
  }

  private async analyzeSourceStructure(): Promise<void> {
    console.log('  📁 Analyzing source structure...');
    
    // Map source directories
    const directories = [
      'audio', 'compute', 'core', 'foliage', 'gameplay', 
      'particles', 'rendering', 'systems', 'types', 'ui', 
      'utils', 'wasm', 'workers', 'world'
    ];
    
    for (const dir of directories) {
      const dirPath = path.join(SRC_DIR, dir);
      if (fs.existsSync(dirPath)) {
        const files = this.getTsFiles(dirPath);
        console.log(`    ${dir}: ${files.length} files`);
      }
    }
  }

  private getTsFiles(dir: string): string[] {
    const files: string[] = [];
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.getTsFiles(fullPath));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }
    
    return files;
  }

  private defineChunkStrategies(): void {
    console.log('  🎯 Defining chunk strategies...');
    
    this.plan.chunks = [
      {
        name: 'core',
        description: 'Essential runtime - scene, renderer, camera, basic input',
        files: [
          'src/core/init.ts',
          'src/core/input.ts',
          'src/core/config.ts',
          'src/core/cycle.ts',
          'src/main.ts'
        ],
        priority: 'critical',
        preloadStrategy: 'immediate',
        estimatedSize: 150000,
        dependencies: ['three']
      },
      {
        name: 'foliage',
        description: 'Foliage rendering systems - trees, flowers, particles',
        files: [
          'src/foliage/common.ts',
          'src/foliage/tree-batcher.ts',
          'src/foliage/flower-batcher.ts',
          'src/foliage/mushroom-batcher.ts',
          'src/foliage/cloud-batcher.ts',
          'src/foliage/lantern-batcher.ts',
          'src/foliage/glowing-flower-batcher.ts'
        ],
        priority: 'high',
        preloadStrategy: 'lazy',
        estimatedSize: 300000,
        dependencies: ['core', 'three/tsl']
      },
      {
        name: 'audio',
        description: 'Audio system and music reactivity',
        files: [
          'src/audio/audio-system.ts',
          'src/audio/beat-sync.ts',
          'src/systems/music-reactivity.ts'
        ],
        priority: 'medium',
        preloadStrategy: 'interaction',
        estimatedSize: 100000,
        dependencies: ['core']
      },
      {
        name: 'shaders',
        description: 'TSL shaders and materials',
        files: [
          'src/rendering/materials.ts',
          'src/rendering/material_types.ts',
          'src/rendering/shader-warmup.ts'
        ],
        priority: 'high',
        preloadStrategy: 'lazy',
        estimatedSize: 200000,
        dependencies: ['core', 'three/tsl']
      },
      {
        name: 'wasm',
        description: 'WebAssembly physics module',
        files: [
          'src/wasm/candy_physics.wasm',
          'src/utils/wasm-loader.js'
        ],
        priority: 'high',
        preloadStrategy: 'lazy',
        estimatedSize: 100000,
        dependencies: ['core']
      },
      {
        name: 'weather',
        description: 'Weather system and effects',
        files: [
          'src/systems/weather.ts',
          'src/systems/weather.core.ts',
          'src/systems/weather-types.ts',
          'src/foliage/rainbow.ts',
          'src/foliage/aurora.ts',
          'src/foliage/stars.ts'
        ],
        priority: 'medium',
        preloadStrategy: 'idle',
        estimatedSize: 150000,
        dependencies: ['core', 'foliage']
      },
      {
        name: 'gameplay',
        description: 'Gameplay mechanics - blaster, mines, harpoon',
        files: [
          'src/gameplay/rainbow-blaster.ts',
          'src/gameplay/jitter-mines.ts',
          'src/gameplay/harpoon-line.ts'
        ],
        priority: 'medium',
        preloadStrategy: 'interaction',
        estimatedSize: 80000,
        dependencies: ['core']
      },
      {
        name: 'effects',
        description: 'Visual effects - particles, impacts, ribbons',
        files: [
          'src/foliage/impacts.ts',
          'src/foliage/ribbons.ts',
          'src/foliage/sparkle-trail.ts',
          'src/foliage/pollen.ts',
          'src/foliage/fireflies.ts'
        ],
        priority: 'low',
        preloadStrategy: 'idle',
        estimatedSize: 120000,
        dependencies: ['core', 'foliage']
      },
      {
        name: 'editor',
        description: 'Development tools and editor features',
        files: [
          'src/ui/loading-screen.ts',
          'src/utils/profiler.js',
          'src/utils/startup-profiler.ts'
        ],
        priority: 'low',
        preloadStrategy: 'idle',
        estimatedSize: 50000,
        dependencies: ['core']
      }
    ];
  }

  private identifyDynamicImports(): void {
    console.log('  📦 Identifying dynamic import opportunities...');
    
    this.plan.dynamicImports = [
      {
        feature: 'Audio System',
        currentImport: `import { AudioSystem } from './audio/audio-system.ts';`,
        proposedImport: `const { AudioSystem } = await import('./audio/audio-system.ts');`,
        trigger: 'User interaction (first click) or settings toggle',
        estimatedSavings: 100000
      },
      {
        feature: 'Weather Effects',
        currentImport: `import { WeatherSystem } from './systems/weather.ts';`,
        proposedImport: `const { WeatherSystem } = await import('./systems/weather.ts');`,
        trigger: 'Weather change event or after initial scene load',
        estimatedSavings: 150000
      },
      {
        feature: 'Debug Tools',
        currentImport: `import { profiler } from './utils/profiler.js';`,
        proposedImport: `const { profiler } = await import('./utils/profiler.js');`,
        trigger: 'Development mode only - never load in production',
        estimatedSavings: 30000
      },
      {
        feature: 'Foliage Batching',
        currentImport: `import { treeBatcher, flowerBatcher } from './foliage/index.ts';`,
        proposedImport: `const { treeBatcher, flowerBatcher } = await import('./foliage/index.ts');`,
        trigger: 'Near loading completion - preload strategy',
        estimatedSavings: 250000
      },
      {
        feature: 'WASM Physics',
        currentImport: `import { initWasm } from './utils/wasm-loader.js';`,
        proposedImport: `const { initWasm } = await import('./utils/wasm-loader.js');`,
        trigger: 'After core scene initialization',
        estimatedSavings: 100000
      },
      {
        feature: 'Gameplay Weapons',
        currentImport: `import { fireRainbow } from './gameplay/rainbow-blaster.ts';`,
        proposedImport: `const { fireRainbow } = await import('./gameplay/rainbow-blaster.ts');`,
        trigger: 'Weapon unlock or first use',
        estimatedSavings: 80000
      }
    ];
  }

  private generatePreloadHints(): void {
    console.log('  🚀 Generating preload hints...');
    
    this.plan.preloadHints = [
      {
        resource: '/assets/map.json',
        as: 'fetch',
        type: 'preload',
        condition: 'Critical path - needed for world generation'
      },
      {
        resource: '/chunks/foliage.js',
        as: 'script',
        type: 'prefetch',
        condition: 'After core initialization completes'
      },
      {
        resource: '/chunks/wasm.js',
        as: 'script',
        type: 'prefetch',
        condition: 'After scene is interactive'
      },
      {
        resource: '/chunks/audio.js',
        as: 'script',
        type: 'prefetch',
        condition: 'When user shows intent (hovers over audio button)'
      },
      {
        resource: '/chunks/shaders.js',
        as: 'script',
        type: 'modulepreload',
        condition: 'During loading screen after core ready'
      },
      {
        resource: '/assets/colorcode.png',
        as: 'image',
        type: 'preload',
        condition: 'Critical texture needed immediately'
      },
      {
        resource: '/chunks/weather.js',
        as: 'script',
        type: 'prefetch',
        condition: 'Idle time after initial load'
      },
      {
        resource: '/chunks/effects.js',
        as: 'script',
        type: 'prefetch',
        condition: 'When approaching area with effects'
      }
    ];
  }

  private generateImplementation(): void {
    // Generate Vite config
    this.plan.implementation.viteConfig = `// vite.config.ts - Optimized for code splitting
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
          if (/\.(png|jpg|svg|gif)$/.test(info.name || '')) {
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
`;

    // Generate dynamic import examples
    this.plan.implementation.dynamicImportExamples = {
      'audio-system': `// Dynamic audio system loading
class LazyAudioSystem {
  private audioSystem: any = null;
  private loading: Promise<any> | null = null;
  
  async init() {
    if (this.audioSystem) return this.audioSystem;
    if (this.loading) return this.loading;
    
    this.loading = import('./audio/audio-system.ts')
      .then(({ AudioSystem }) => {
        this.audioSystem = new AudioSystem();
        return this.audioSystem;
      });
    
    return this.loading;
  }
  
  async playSound(sound: string) {
    const audio = await this.init();
    return audio.play(sound);
  }
}

export const lazyAudio = new LazyAudioSystem();

// Usage - loads only when needed
button.addEventListener('click', () => {
  lazyAudio.playSound('click');
});
`,
      'foliage-preload': `// Preload foliage when near loading completion
class FoliagePreloader {
  private foliageModule: any = null;
  
  preload() {
    // Start loading in background after core is ready
    if (document.readyState === 'complete') {
      this.doPreload();
    } else {
      window.addEventListener('load', () => this.doPreload());
    }
  }
  
  private async doPreload() {
    // Wait a bit for initial render
    await new Promise(r => setTimeout(r, 100));
    
    // Prefetch the chunk
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'script';
    link.href = '/chunks/foliage-[hash].js';
    document.head.appendChild(link);
    
    // Actually import when needed
    this.foliageModule = await import('./foliage/index.ts');
  }
  
  getFoliage() {
    return this.foliageModule;
  }
}

export const foliagePreloader = new FoliagePreloader();
`,
      'wasm-loader': `// Lazy WASM loading
let wasmModule: any = null;
let wasmPromise: Promise<any> | null = null;

export async function initWasmLazy() {
  if (wasmModule) return wasmModule;
  if (wasmPromise) return wasmPromise;
  
  wasmPromise = import('./utils/wasm-loader.js')
    .then(({ initWasm }) => initWasm())
    .then((module) => {
      wasmModule = module;
      return module;
    });
  
  return wasmPromise;
}

// Preload hint for WASM
export function preloadWasm() {
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'fetch';
  link.href = '/wasm/candy_physics-[hash].wasm';
  document.head.appendChild(link);
}
`,
      'debug-tools': `// Development-only debug tools
let debugTools: any = null;

export async function loadDebugTools() {
  // Only load in development
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  
  if (debugTools) return debugTools;
  
  const { profiler, enableStartupProfiler } = await import('./utils/profiler.js');
  debugTools = { profiler, enableStartupProfiler };
  return debugTools;
}

// Usage
if (location.hash === '#debug') {
  loadDebugTools().then(tools => {
    tools?.enableStartupProfiler();
  });
}
`,
      'conditional-features': `// Feature-based code splitting
const featureModules = {
  'weather': () => import('./systems/weather.ts'),
  'advanced-effects': () => import('./foliage/effects.ts'),
  'multiplayer': () => import('./systems/multiplayer.ts')
};

export async function loadFeature(feature: keyof typeof featureModules) {
  const loader = featureModules[feature];
  if (!loader) throw new Error(\`Unknown feature: \${feature}\`);
  return loader();
}

// Check user preferences and load accordingly
const userPrefs = JSON.parse(localStorage.getItem('prefs') || '{}');

if (userPrefs.enableWeather) {
  loadFeature('weather');
}

if (userPrefs.quality === 'high') {
  loadFeature('advanced-effects');
}
`
    };

    // Generate HTML preloads
    this.plan.implementation.htmlPreloads = `<!-- Critical resource preloading -->
<head>
  <!-- Preload critical assets -->
  <link rel="preload" href="/assets/colorcode.png" as="image" type="image/png" />
  <link rel="preload" href="/assets/map.json" as="fetch" crossorigin />
  
  <!-- Preload core JavaScript -->
  <link rel="modulepreload" href="/chunks/vendor-[hash].js" />
  <link rel="modulepreload" href="/chunks/core-[hash].js" />
  
  <!-- Prefetch non-critical chunks (low priority) -->
  <link rel="prefetch" href="/chunks/foliage-[hash].js" as="script" />
  <link rel="prefetch" href="/chunks/shaders-[hash].js" as="script" />
  
  <!-- DNS prefetch for external resources -->
  <link rel="dns-prefetch" href="https://cdn.example.com" />
  
  <!-- Preconnect for critical origins -->
  <link rel="preconnect" href="https://api.example.com" />
</head>

<!-- Dynamic prefetch after load -->
<script>
  // Prefetch foliage when core is ready
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = '/chunks/foliage-[hash].js';
      document.head.appendChild(link);
    }, { timeout: 2000 });
  }
  
  // Prefetch on user intent
  document.querySelector('#audio-toggle')?.addEventListener('mouseenter', () => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = '/chunks/audio-[hash].js';
    document.head.appendChild(link);
  });
</script>
`;
  }

  generateReport(outputPath: string = OUTPUT_FILE): void {
    console.log(`  📝 Generating report: ${outputPath}`);
    
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write markdown report
    fs.writeFileSync(outputPath, this.generateMarkdownReport());
    
    // Write implementation files
    const implDir = path.join(outputDir, 'code-splitting');
    if (!fs.existsSync(implDir)) {
      fs.mkdirSync(implDir, { recursive: true });
    }
    
    fs.writeFileSync(
      path.join(implDir, 'vite.config.ts'),
      this.plan.implementation.viteConfig
    );
    
    for (const [name, code] of Object.entries(this.plan.implementation.dynamicImportExamples)) {
      fs.writeFileSync(
        path.join(implDir, `${name}.example.ts`),
        code
      );
    }
    
    fs.writeFileSync(
      path.join(implDir, 'preload-hints.html'),
      this.plan.implementation.htmlPreloads
    );
    
    console.log(`  ✅ Report saved: ${outputPath}`);
    console.log(`  ✅ Implementation templates: ${implDir}/`);
  }

  private generateMarkdownReport(): string {
    const totalEstimatedSize = this.plan.chunks.reduce((sum, c) => sum + c.estimatedSize, 0);
    const totalSavings = this.plan.dynamicImports.reduce((sum, d) => sum + d.estimatedSavings, 0);
    
    let md = `# ✂️ Code Splitting Strategy Plan\n\n`;
    md += `> Generated: ${new Date().toLocaleString()}\n\n`;
    md += `## Summary\n\n`;
    md += `- **Total Estimated Bundle Size**: ${(totalEstimatedSize / 1024 / 1024).toFixed(2)} MB\n`;
    md += `- **Number of Chunks**: ${this.plan.chunks.length}\n`;
    md += `- **Dynamic Import Opportunities**: ${this.plan.dynamicImports.length}\n`;
    md += `- **Estimated Lazy-Load Savings**: ${(totalSavings / 1024).toFixed(0)} KB\n\n`;
    
    // Chunk strategy table
    md += `## 📦 Chunk Strategy\n\n`;
    md += `| Chunk | Priority | Strategy | Est. Size | Dependencies |\n`;
    md += `|-------|----------|----------|-----------|--------------|\n`;
    
    for (const chunk of this.plan.chunks) {
      const sizeStr = (chunk.estimatedSize / 1024).toFixed(0) + ' KB';
      const priorityEmoji = {
        critical: '🔴',
        high: '🟠',
        medium: '🟡',
        low: '🟢'
      };
      md += `| ${chunk.name} | ${priorityEmoji[chunk.priority]} ${chunk.priority} | ${chunk.preloadStrategy} | ${sizeStr} | ${chunk.dependencies.join(', ')} |\n`;
    }
    
    md += `\n`;
    
    // Chunk descriptions
    md += `### Chunk Details\n\n`;
    for (const chunk of this.plan.chunks) {
      md += `#### ${chunk.name}\n\n`;
      md += `${chunk.description}\n\n`;
      md += `- **Priority**: ${chunk.priority}\n`;
      md += `- **Load Strategy**: ${chunk.preloadStrategy}\n`;
      md += `- **Estimated Size**: ${(chunk.estimatedSize / 1024).toFixed(0)} KB\n`;
      md += `- **Files**: \n`;
      for (const file of chunk.files.slice(0, 5)) {
        md += `  - \`${file}\`\n`;
      }
      if (chunk.files.length > 5) {
        md += `  - ... and ${chunk.files.length - 5} more\n`;
      }
      md += `- **Dependencies**: ${chunk.dependencies.join(', ')}\n\n`;
    }
    
    // Dynamic imports
    md += `## 📥 Dynamic Import Opportunities\n\n`;
    for (const imp of this.plan.dynamicImports) {
      md += `### ${imp.feature}\n\n`;
      md += `**Current:**\n`;
      md += `\`\`\`typescript\n${imp.currentImport}\n\`\`\`\n\n`;
      md += `**Proposed:**\n`;
      md += `\`\`\`typescript\n${imp.proposedImport}\n\`\`\`\n\n`;
      md += `- **Trigger**: ${imp.trigger}\n`;
      md += `- **Estimated Savings**: ${(imp.estimatedSavings / 1024).toFixed(0)} KB\n\n`;
    }
    
    // Preload hints
    md += `## 🚀 Preload Hints\n\n`;
    md += `| Resource | Type | As | Condition |\n`;
    md += `|----------|------|-----|-----------|\n`;
    for (const hint of this.plan.preloadHints) {
      md += `| ${hint.resource} | ${hint.type} | ${hint.as} | ${hint.condition} |\n`;
    }
    
    // Implementation guide
    md += `\n## 🛠️ Implementation Guide\n\n`;
    md += `### 1. Update Vite Config\n\n`;
    md += `See \`code-splitting/vite.config.ts\` for the complete configuration.\n\n`;
    md += `Key changes:\n`;
    md += `- Add manual chunking in \`build.rollupOptions.output.manualChunks\`\n`;
    md += `- Configure chunk naming for cache busting\n`;
    md += `- Optimize asset file names by type\n\n`;
    
    md += `### 2. Implement Dynamic Imports\n\n`;
    md += `See example implementations in \`code-splitting/*.example.ts\`:\n\n`;
    for (const name of Object.keys(this.plan.implementation.dynamicImportExamples)) {
      md += `- \`${name}.example.ts\`\n`;
    }
    md += `\n`;
    
    md += `### 3. Add Preload Hints\n\n`;
    md += `Add to your \`index.html\`:\n\n`;
    md += `\`\`\`html\n${this.plan.implementation.htmlPreloads}\n\`\`\`\n\n`;
    
    // Loading sequence
    md += `## ⏱️ Recommended Loading Sequence\n\n`;
    md += `\`\`\`
1. [0ms]     Load HTML + Critical CSS
2. [50ms]    Parse & execute core chunk (scene, renderer, camera)
3. [200ms]   Initialize basic world (ground plane, sky)
4. [500ms]   Show interactive state (user can look around)
5. [800ms]   Start loading foliage (prefetched)
6. [1200ms]  Foliage ready, world fully rendered
7. [2000ms]  Start loading audio (idle callback)
8. [3000ms]  Preload weather effects (idle callback)
9. [on need] Load gameplay features on first interaction
\`\`\`\n\n`;
    
    // Performance targets
    md += `## 🎯 Performance Targets\n\n`;
    md += `| Metric | Target | Current (Est.) |\n`;
    md += `|--------|--------|----------------|\n`;
    md += `| First Contentful Paint | < 1.0s | TBD |\n`;
    md += `| Time to Interactive | < 2.0s | TBD |\n`;
    md += `| Largest Contentful Paint | < 2.5s | TBD |\n`;
    md += `| Total Bundle Size | < 1MB | ${(totalEstimatedSize / 1024 / 1024).toFixed(2)} MB |\n`;
    md += `| Initial Load Size | < 500KB | TBD |\n\n`;
    
    // Monitoring
    md += `## 📊 Monitoring Recommendations\n\n`;
    md += `Track these metrics in production:\n\n`;
    md += `- Chunk load times (Performance Observer)\n`;
    md += `- Dynamic import success rates\n`;
    md += `- Cache hit rates by chunk\n`;
    md += `- Memory usage per chunk\n`;
    md += `- User wait times for lazy-loaded features\n\n`;
    
    return md;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : OUTPUT_FILE;
  
  const strategy = new CodeSplittingStrategy();
  
  try {
    const plan = await strategy.analyze();
    strategy.generateReport(outputPath);
    
    console.log('\n📊 Summary:');
    console.log(`   Chunks: ${plan.chunks.length}`);
    console.log(`   Dynamic Imports: ${plan.dynamicImports.length}`);
    console.log(`   Preload Hints: ${plan.preloadHints.length}`);
    
    const totalSavings = plan.dynamicImports.reduce((sum, d) => sum + d.estimatedSavings, 0);
    console.log(`   Est. Lazy-Load Savings: ${(totalSavings / 1024).toFixed(0)} KB`);
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  }
}

main();
