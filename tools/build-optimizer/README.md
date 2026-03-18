# 🍭 candy_world Build Optimizer

A comprehensive build optimization and bundling analysis system for candy_world.

## Overview

This toolset analyzes and optimizes the candy_world build pipeline, providing:

- 📊 **Bundle Analysis** - Webpack-style treemap visualization
- 🌳 **Tree Shaking Audit** - Dead code elimination verification
- 📦 **Compression Benchmarks** - gzip vs brotli vs zstd comparison
- ✂️ **Code Splitting Strategy** - Intelligent chunking recommendations
- 🖼️ **Asset Optimization** - Image compression and lazy loading
- 🔌 **Enhanced Vite Plugin** - Custom build optimizations
- 💰 **Performance Budgets** - Bundle size monitoring

## Quick Start

```bash
# Run all optimizations
npm run optimize

# Or run individual tools
npm run analyze:bundle
npm run analyze:treeshake
npm run analyze:compress
npm run optimize:assets
npm run optimize:split
npm run budget
```

## Tools

### 1. Bundle Analyzer (`bundle-analyzer.ts`)

Generates Webpack-style bundle visualization with:
- Interactive treemap of bundle composition
- Identification of largest dependencies (Three.js analysis)
- Duplicate code detection across chunks
- Optimization recommendations

**Output:** `stats/bundle-analysis.html`

```bash
npm run analyze:bundle
```

### 2. Tree Shaking Audit (`tree-shaking-audit.ts`)

Verifies dead code elimination effectiveness:
- Exports usage tracking
- Unused function identification in `common.ts`
- Tree-shaking score per file
- Potential byte savings

**Output:** `stats/tree-shaking-report.md`

```bash
npm run analyze:treeshake
```

### 3. Compression Benchmark (`compression-benchmark.ts`)

Compares compression strategies:
- gzip vs brotli vs zstd ratios
- Optimal compression per file type
- Server configuration snippets (nginx, apache, vercel, netlify)
- Bandwidth savings calculations

**Output:** `stats/compression-report.html`

```bash
npm run analyze:compress
```

### 4. Code Splitting Strategy (`code-splitting-strategy.ts`)

Intelligent chunking recommendations:
- Separate chunks: core, foliage, audio, shaders, wasm
- Prefetch/preload hints for critical paths
- Dynamic import() patterns for optional features
- Preload foliage near loading completion

**Output:** `stats/code-splitting-plan.md`

```bash
npm run optimize:split
```

### 5. Asset Optimizer (`asset-optimizer.ts`)

Static asset optimization:
- WebP/AVIF generation for textures
- JSON compression
- Sprite atlas generation for UI
- Lazy-loading strategy

**Output:** `stats/asset-optimization-report.html`

```bash
npm run optimize:assets
```

### 6. Enhanced Vite Plugin (`vite-plugin-enhanced.ts`)

Custom Vite plugin with:
- WASM optimization (strip debug symbols with wasm-opt)
- TSL shader precompilation cache
- Dead code elimination for unused CandyPresets
- Build-time constant folding (process.env checks)

**Usage:**
```typescript
// vite.config.ts
import { candyWorldOptimizer } from './tools/build-optimizer/src/vite-plugin-enhanced';

export default {
  plugins: [
    candyWorldOptimizer({
      wasmOpt: true,
      tslCache: true,
      deadCodeElimination: true,
      constantFolding: true
    })
  ]
};
```

### 7. Performance Budget (`performance-budget.ts`)

Validates bundle sizes against budgets:

```json
{
  "budgets": {
    "main": "200kb",
    "vendor": "500kb",
    "wasm": "100kb",
    "total": "2mb"
  }
}
```

**Output:** `stats/budget-report.json`

```bash
npm run budget
npm run budget:check  # Fails CI on budget exceed
```

## Configuration

### Performance Budgets

Edit budgets in `src/performance-budget.ts`:

```typescript
const DEFAULT_CONFIG: BudgetConfig = {
  budgets: {
    main: '200kb',
    vendor: '500kb',
    wasm: '100kb',
    total: '2mb'
  },
  thresholds: {
    warning: 0.8,  // 80% of budget
    error: 1.0     // 100% of budget
  }
};
```

### Vite Config Integration

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { candyWorldOptimizer } from './tools/build-optimizer/src/vite-plugin-enhanced';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    candyWorldOptimizer({
      wasmOpt: true,
      tslCache: true,
      deadCodeElimination: true,
      constantFolding: true
    })
  ],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['three'],
          core: ['./src/core/init.ts', './src/core/input.ts'],
          foliage: ['./src/foliage/common.ts'],
          audio: ['./src/audio/audio-system.ts'],
          shaders: ['./src/rendering/materials.ts']
        }
      }
    }
  }
});
```

## CI Integration

### GitHub Actions

```yaml
name: Build Optimization

on: [push, pull_request]

jobs:
  optimize:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - run: npm ci
      
      - name: Run optimizations
        run: npm run optimize
      
      - name: Check budgets
        run: npm run budget:check
      
      - name: Upload reports
        uses: actions/upload-artifact@v3
        with:
          name: optimization-reports
          path: tools/build-optimizer/stats/
```

### Pre-commit Hook

```bash
#!/bin/bash
# .husky/pre-commit

npm run budget:check || exit 1
```

## Reports

All reports are generated in `tools/build-optimizer/stats/`:

| Report | Description |
|--------|-------------|
| `bundle-analysis.html` | Interactive treemap visualization |
| `tree-shaking-report.md` | Dead code analysis |
| `compression-report.html` | Compression benchmarks |
| `code-splitting-plan.md` | Chunking strategy |
| `asset-optimization-report.html` | Asset optimization |
| `budget-report.json` | Performance budgets |
| `OPTIMIZATION_REPORT.md` | Comprehensive summary |

## Key Findings & Recommendations

### High Priority

1. **Three.js Bundle Size**
   - Current: ~500KB+
   - Action: Use dynamic imports for optional Three.js features
   - Impact: 40% reduction possible

2. **WASM Optimization**
   - Install wasm-opt (Binaryen): `apt install binaryen`
   - Enable in build: `wasm-opt -O3 -s`
   - Impact: 30-50% size reduction

3. **Foliage Code Splitting**
   - Move foliage to lazy-loaded chunk
   - Preload after core initialization
   - Impact: Faster initial paint

### Medium Priority

1. **Image Formats**
   - Convert textures to WebP/AVIF
   - Use `<picture>` element with fallbacks
   - Impact: 60-80% image size reduction

2. **JSON Compression**
   - Minify map.json
   - Enable gzip on server
   - Impact: ~350KB savings

3. **Shader Caching**
   - Cache compiled TSL shaders
   - Avoid recompilation on hot reload
   - Impact: Faster development

### Low Priority

1. **Sprite Atlases**
   - Combine small UI icons
   - Reduce HTTP requests
   - Impact: Minor loading improvement

## Performance Targets

| Metric | Target | Current (Est.) |
|--------|--------|----------------|
| First Contentful Paint | < 1.0s | TBD |
| Time to Interactive | < 2.0s | TBD |
| Largest Contentful Paint | < 2.5s | TBD |
| Total Bundle Size | < 1MB | TBD |
| Initial Load Size | < 500KB | TBD |

## Load Time Estimates

| Connection | Current (Est.) | Optimized (Est.) |
|------------|----------------|------------------|
| 3G | ~15s | ~8s |
| 4G | ~4s | ~2s |
| 5G | ~1s | ~0.5s |

## Architecture

```
tools/build-optimizer/
├── src/
│   ├── bundle-analyzer.ts        # Bundle visualization
│   ├── tree-shaking-audit.ts     # Dead code analysis
│   ├── compression-benchmark.ts  # Compression testing
│   ├── code-splitting-strategy.ts # Chunking plan
│   ├── asset-optimizer.ts        # Asset optimization
│   ├── vite-plugin-enhanced.ts   # Custom Vite plugin
│   ├── performance-budget.ts     # Budget checking
│   └── run-all-optimizations.ts  # Orchestrator
├── stats/                        # Generated reports
├── package.json
└── README.md                     # This file
```

## Troubleshooting

### Common Issues

**1. wasm-opt not found**
```bash
# Ubuntu/Debian
sudo apt install binaryen

# macOS
brew install binaryen

# Or skip WASM optimization
candyWorldOptimizer({ wasmOpt: false })
```

**2. cwebp/avifenc not found**
```bash
# Ubuntu/Debian
sudo apt install webp libavif-bin

# macOS
brew install webp libavif

# Or use Node.js fallbacks
```

**3. Budget check fails CI**
```bash
# Adjust budgets in performance-budget.ts
const DEFAULT_CONFIG: BudgetConfig = {
  budgets: {
    main: '300kb',  // Increased from 200kb
    vendor: '600kb', // Increased from 500kb
    wasm: '150kb',
    total: '3mb'
  }
};
```

## Contributing

To add a new optimization tool:

1. Create `src/your-tool.ts`
2. Add script to `package.json`
3. Register in `run-all-optimizations.ts`
4. Update this README

## License

MIT
