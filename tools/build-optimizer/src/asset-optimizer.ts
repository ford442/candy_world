#!/usr/bin/env tsx
/**
 * Asset Optimizer for candy_world
 * 
 * Generates WebP/AVIF versions of textures
 * Compresses JSON assets
 * Generates sprite atlases for UI
 * Creates lazy-loading strategy for assets
 * 
 * Usage: tsx asset-optimizer.ts [--output ./stats/asset-optimization-report.html]
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const STATS_DIR = path.join(__dirname, '../stats');
const OUTPUT_FILE = path.join(STATS_DIR, 'asset-optimization-report.html');

interface AssetInfo {
  path: string;
  size: number;
  type: 'image' | 'json' | 'audio' | 'font' | 'other';
  extension: string;
  optimization: OptimizationResult;
}

interface OptimizationResult {
  canOptimize: boolean;
  recommendedFormat?: string;
  estimatedSavings: number;
  suggestedActions: string[];
}

interface ImageVariant {
  format: 'webp' | 'avif' | 'png' | 'jpg';
  quality: number;
  estimatedSize: number;
}

interface SpriteAtlas {
  name: string;
  sprites: string[];
  dimensions: { width: number; height: number };
  estimatedSize: number;
  css: string;
}

interface AssetReport {
  timestamp: string;
  assets: AssetInfo[];
  imageVariants: Map<string, ImageVariant[]>;
  spriteAtlases: SpriteAtlas[];
  lazyLoadingStrategy: LazyLoadingStrategy;
  totalCurrentSize: number;
  totalPotentialSavings: number;
  recommendations: AssetRecommendation[];
}

interface LazyLoadingStrategy {
  critical: string[];
  deferred: string[];
  lazy: string[];
  preloadHints: string[];
}

interface AssetRecommendation {
  asset: string;
  issue: string;
  action: string;
  savings: number;
  priority: 'high' | 'medium' | 'low';
}

class AssetOptimizer {
  private report: AssetReport = {
    timestamp: new Date().toISOString(),
    assets: [],
    imageVariants: new Map(),
    spriteAtlases: [],
    lazyLoadingStrategy: {
      critical: [],
      deferred: [],
      lazy: [],
      preloadHints: []
    },
    totalCurrentSize: 0,
    totalPotentialSavings: 0,
    recommendations: []
  };

  private hasCwebp = false;
  private hasAvifenc = false;
  private hasImageMagick = false;

  async analyze(): Promise<AssetReport> {
    console.log('🖼️ Analyzing assets...');
    
    // Check available tools
    this.checkTools();
    
    // Scan assets directory
    await this.scanAssets();
    
    // Analyze images for optimization
    await this.analyzeImages();
    
    // Analyze JSON files
    await this.analyzeJsonFiles();
    
    // Generate sprite atlas recommendations
    this.generateSpriteAtlasRecommendations();
    
    // Generate lazy loading strategy
    this.generateLazyLoadingStrategy();
    
    // Generate recommendations
    this.generateRecommendations();
    
    return this.report;
  }

  private checkTools(): void {
    console.log('  🔧 Checking image optimization tools...');
    
    const tools = [
      { cmd: 'cwebp --version', name: 'cwebp', flag: 'hasCwebp' },
      { cmd: 'avifenc --version', name: 'avifenc', flag: 'hasAvifenc' },
      { cmd: 'convert --version', name: 'ImageMagick', flag: 'hasImageMagick' }
    ];
    
    for (const tool of tools) {
      try {
        execSync(tool.cmd, { stdio: 'pipe' });
        (this as any)[tool.flag] = true;
        console.log(`    ✅ ${tool.name} available`);
      } catch {
        console.log(`    ⚠️ ${tool.name} not available`);
      }
    }
  }

  private async scanAssets(): Promise<void> {
    console.log('  📁 Scanning assets...');
    
    const scanDirs = [ASSETS_DIR, PUBLIC_DIR].filter(fs.existsSync);
    
    for (const dir of scanDirs) {
      await this.scanDirectory(dir);
    }
    
    console.log(`    Found ${this.report.assets.length} assets`);
  }

  private async scanDirectory(dir: string): Promise<void> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath);
      } else {
        const stat = fs.statSync(fullPath);
        const ext = path.extname(fullPath).toLowerCase();
        
        const asset: AssetInfo = {
          path: fullPath,
          size: stat.size,
          type: this.getAssetType(ext),
          extension: ext,
          optimization: {
            canOptimize: false,
            estimatedSavings: 0,
            suggestedActions: []
          }
        };
        
        this.report.assets.push(asset);
        this.report.totalCurrentSize += stat.size;
      }
    }
  }

  private getAssetType(ext: string): AssetInfo['type'] {
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif'];
    const audioExts = ['.mp3', '.wav', '.ogg', '.m4a'];
    const fontExts = ['.woff', '.woff2', '.ttf', '.otf'];
    
    if (imageExts.includes(ext)) return 'image';
    if (ext === '.json') return 'json';
    if (audioExts.includes(ext)) return 'audio';
    if (fontExts.includes(ext)) return 'font';
    return 'other';
  }

  private async analyzeImages(): Promise<void> {
    console.log('  🎨 Analyzing images for optimization...');
    
    const images = this.report.assets.filter(a => a.type === 'image');
    
    for (const image of images) {
      const variants: ImageVariant[] = [];
      
      // Current size
      variants.push({
        format: image.extension.replace('.', '') as any,
        quality: 100,
        estimatedSize: image.size
      });
      
      // Estimate WebP conversion
      if (!image.extension.includes('webp')) {
        variants.push({
          format: 'webp',
          quality: 85,
          estimatedSize: Math.floor(image.size * 0.3) // ~70% savings
        });
      }
      
      // Estimate AVIF conversion
      if (!image.extension.includes('avif')) {
        variants.push({
          format: 'avif',
          quality: 80,
          estimatedSize: Math.floor(image.size * 0.2) // ~80% savings
        });
      }
      
      // Find best format
      const best = variants.reduce((a, b) => 
        a.estimatedSize < b.estimatedSize ? a : b
      );
      
      const current = variants[0];
      const savings = current.estimatedSize - best.estimatedSize;
      
      image.optimization = {
        canOptimize: savings > 1024,
        recommendedFormat: best.format,
        estimatedSavings: savings,
        suggestedActions: savings > 1024 ? [
          `Convert to ${best.format.toUpperCase()} for ${((savings / image.size) * 100).toFixed(0)}% size reduction`,
          'Generate responsive variants (1x, 2x)',
          'Add picture element with fallback'
        ] : []
      };
      
      this.report.imageVariants.set(image.path, variants);
      this.report.totalPotentialSavings += savings;
    }
  }

  private async analyzeJsonFiles(): Promise<void> {
    console.log('  📄 Analyzing JSON files...');
    
    const jsonFiles = this.report.assets.filter(a => a.type === 'json');
    
    for (const jsonFile of jsonFiles) {
      try {
        const content = fs.readFileSync(jsonFile.path, 'utf-8');
        const originalSize = jsonFile.size;
        
        // Minified size estimate
        const minified = JSON.stringify(JSON.parse(content));
        const minifiedSize = Buffer.byteLength(minified, 'utf-8');
        
        // Compressed size estimate (gzip)
        const compressedSize = Math.floor(minifiedSize * 0.25);
        
        const savings = originalSize - compressedSize;
        
        jsonFile.optimization = {
          canOptimize: savings > 100,
          estimatedSavings: savings,
          suggestedActions: [
            `Minify JSON (save ${originalSize - minifiedSize} bytes)`,
            `Enable gzip compression (save ${minifiedSize - compressedSize} bytes)`,
            'Consider splitting large JSON into chunks'
          ]
        };
        
        this.report.totalPotentialSavings += savings;
      } catch {
        // Invalid JSON, skip
      }
    }
  }

  private generateSpriteAtlasRecommendations(): void {
    console.log('  🎭 Generating sprite atlas recommendations...');
    
    // Check for UI icons that could be sprited
    const potentialSprites = this.report.assets.filter(a => {
      const name = path.basename(a.path).toLowerCase();
      return a.type === 'image' && a.size < 50 * 1024 // Small images
        && (name.includes('icon') || name.includes('button') || name.includes('ui'));
    });
    
    if (potentialSprites.length >= 4) {
      const atlas: SpriteAtlas = {
        name: 'ui-icons',
        sprites: potentialSprites.map(s => s.path),
        dimensions: { width: 512, height: 512 },
        estimatedSize: potentialSprites.reduce((sum, s) => sum + s.size, 0) * 0.7,
        css: this.generateSpriteCSS(potentialSprites)
      };
      
      this.report.spriteAtlases.push(atlas);
      
      // Add savings
      const currentTotal = potentialSprites.reduce((sum, s) => sum + s.size, 0);
      this.report.totalPotentialSavings += (currentTotal - atlas.estimatedSize);
    }
  }

  private generateSpriteCSS(sprites: AssetInfo[]): string {
    let css = '/* Sprite Atlas CSS */\n';
    css += '.sprite { background-image: url("ui-icons.png"); background-repeat: no-repeat; }\n\n';
    
    // Simple grid layout
    const cols = Math.ceil(Math.sqrt(sprites.length));
    const size = 64; // Assume 64x64 icons
    
    sprites.forEach((sprite, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const name = path.basename(sprite.path, path.extname(sprite.path));
      
      css += `.sprite-${name} {\n`;
      css += `  width: ${size}px;\n`;
      css += `  height: ${size}px;\n`;
      css += `  background-position: -${col * size}px -${row * size}px;\n`;
      css += `}\n\n`;
    });
    
    return css;
  }

  private generateLazyLoadingStrategy(): void {
    console.log('  🐌 Generating lazy loading strategy...');
    
    // Critical - needed immediately
    this.report.lazyLoadingStrategy.critical = [
      '/assets/colorcode.png',
      '/assets/map.json'
    ];
    
    // Deferred - load after initial render
    this.report.lazyLoadingStrategy.deferred = [
      '/chunks/foliage.js',
      '/chunks/shaders.js'
    ];
    
    // Lazy - load on demand
    this.report.lazyLoadingStrategy.lazy = [
      '/chunks/audio.js',
      '/chunks/weather.js',
      '/chunks/effects.js',
      '/assets/splash.png'
    ];
    
    // Preload hints
    this.report.lazyLoadingStrategy.preloadHints = [
      '<link rel="preload" href="/assets/colorcode.png" as="image"/>',
      '<link rel="preload" href="/assets/map.json" as="fetch" crossorigin/>',
      '<link rel="prefetch" href="/chunks/foliage.js" as="script"/>'
    ];
  }

  private generateRecommendations(): void {
    // Sort assets by potential savings
    const optimizable = this.report.assets
      .filter(a => a.optimization.canOptimize)
      .sort((a, b) => b.optimization.estimatedSavings - a.optimization.estimatedSavings);
    
    for (const asset of optimizable.slice(0, 20)) {
      this.report.recommendations.push({
        asset: path.relative(ROOT_DIR, asset.path),
        issue: `Unoptimized ${asset.type} (${this.formatBytes(asset.size)})`,
        action: asset.optimization.suggestedActions[0],
        savings: asset.optimization.estimatedSavings,
        priority: asset.optimization.estimatedSavings > 100 * 1024 ? 'high' : 'medium'
      });
    }
    
    // Add sprite atlas recommendation
    if (this.report.spriteAtlases.length > 0) {
      const atlas = this.report.spriteAtlases[0];
      this.report.recommendations.push({
        asset: `${atlas.sprites.length} UI icons`,
        issue: 'Multiple small images causing extra HTTP requests',
        action: `Create sprite atlas: ${atlas.name}`,
        savings: atlas.sprites.reduce((sum, s) => sum + fs.statSync(s).size, 0) - atlas.estimatedSize,
        priority: 'medium'
      });
    }
  }

  generateReport(outputPath: string = OUTPUT_FILE): void {
    console.log(`  📝 Generating report: ${outputPath}`);
    
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write HTML report
    fs.writeFileSync(outputPath, this.generateHTML());
    
    // Write JSON report
    const jsonPath = outputPath.replace('.html', '.json');
    fs.writeFileSync(jsonPath, JSON.stringify(this.report, null, 2));
    
    // Generate optimization script
    const scriptPath = path.join(outputDir, 'optimize-assets.sh');
    fs.writeFileSync(scriptPath, this.generateOptimizationScript());
    fs.chmodSync(scriptPath, 0o755);
    
    // Generate image component template
    const componentPath = path.join(outputDir, 'ResponsiveImage.astro');
    fs.writeFileSync(componentPath, this.generateImageComponent());
    
    console.log(`  ✅ Reports saved:`);
    console.log(`     HTML: ${outputPath}`);
    console.log(`     JSON: ${jsonPath}`);
    console.log(`     Script: ${scriptPath}`);
    console.log(`     Component: ${componentPath}`);
  }

  private generateHTML(): string {
    const images = this.report.assets.filter(a => a.type === 'image');
    const jsonFiles = this.report.assets.filter(a => a.type === 'json');
    
    const imageSavings = images.reduce((sum, i) => sum + i.optimization.estimatedSavings, 0);
    const jsonSavings = jsonFiles.reduce((sum, j) => sum + j.optimization.estimatedSavings, 0);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>candy_world Asset Optimization Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0f;
      color: #e0e0e0;
      line-height: 1.6;
    }
    .header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      padding: 2rem;
      border-bottom: 1px solid #2a2a3e;
    }
    .header h1 {
      font-size: 2rem;
      background: linear-gradient(90deg, #ff6b6b, #ffeaa7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }
    .section {
      background: rgba(255,255,255,0.03);
      border-radius: 16px;
      padding: 2rem;
      margin-bottom: 2rem;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .section h2 { margin-bottom: 1.5rem; color: #fff; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: rgba(255,255,255,0.05);
      padding: 1.5rem;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .stat-value { font-size: 2rem; font-weight: bold; color: #4ecdc4; }
    .stat-label { color: #888; font-size: 0.9rem; margin-top: 0.25rem; }
    .recommendation {
      padding: 1rem;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      margin-bottom: 1rem;
      border-left: 4px solid;
    }
    .recommendation.high { border-color: #ff6b6b; }
    .recommendation.medium { border-color: #fdcb6e; }
    .recommendation.low { border-color: #00b894; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    th { color: #888; font-weight: 500; }
    .savings { color: #00b894; font-weight: bold; }
    .format-comparison { display: flex; gap: 1rem; margin: 0.5rem 0; }
    .format-bar {
      height: 24px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      padding: 0 0.5rem;
      font-size: 0.8rem;
      color: #fff;
    }
    .format-bar.original { background: #666; }
    .format-bar.webp { background: #4ecdc4; }
    .format-bar.avif { background: #ff6b6b; }
    .code-block {
      background: rgba(0,0,0,0.5);
      padding: 1.5rem;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1rem 0;
    }
    .code-block code {
      font-family: 'SF Mono', monospace;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🖼️ Asset Optimization Report</h1>
    <p style="color: #888; margin-top: 0.5rem;">Generated: ${new Date(this.report.timestamp).toLocaleString()}</p>
  </div>

  <div class="container">
    <div class="section">
      <h2>Summary</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${this.formatBytes(this.report.totalCurrentSize)}</div>
          <div class="stat-label">Current Total Size</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: #00b894;">${this.formatBytes(this.report.totalPotentialSavings)}</div>
          <div class="stat-label">Potential Savings</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${this.report.assets.length}</div>
          <div class="stat-label">Total Assets</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${this.report.assets.filter(a => a.optimization.canOptimize).length}</div>
          <div class="stat-label">Optimizable Assets</div>
        </div>
      </div>

      <div class="chart-container" style="height: 300px;">
        <canvas id="savingsChart"></canvas>
      </div>
    </div>

    <div class="section">
      <h2>🎯 Top Recommendations</h2>
      ${this.report.recommendations.slice(0, 10).map(rec => `
        <div class="recommendation ${rec.priority}">
          <strong>${rec.asset}</strong>
          <p style="color: #aaa; margin: 0.5rem 0;">${rec.issue}</p>
          <p>💡 ${rec.action}</p>
          <div class="savings">Save ${this.formatBytes(rec.savings)}</div>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <h2>🖼️ Image Optimization</h2>
      <p style="color: #888; margin-bottom: 1rem;">
        Estimated savings from modern formats: <strong class="savings">${this.formatBytes(imageSavings)}</strong>
      </p>
      
      <table>
        <thead>
          <tr>
            <th>Image</th>
            <th>Current</th>
            <th>WebP Est.</th>
            <th>AVIF Est.</th>
            <th>Best Savings</th>
          </tr>
        </thead>
        <tbody>
          ${images.slice(0, 10).map(img => {
            const variants = this.report.imageVariants.get(img.path) || [];
            const original = variants[0];
            const webp = variants.find(v => v.format === 'webp');
            const avif = variants.find(v => v.format === 'avif');
            const originalSize = original && original.estimatedSize ? original.estimatedSize : img.size;
            return `
              <tr>
                <td>${path.basename(img.path)}</td>
                <td>${this.formatBytes(originalSize)}</td>
                <td>${webp ? this.formatBytes(webp.estimatedSize) : '-'}</td>
                <td>${avif ? this.formatBytes(avif.estimatedSize) : '-'}</td>
                <td class="savings">${this.formatBytes(img.optimization.estimatedSavings)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>📄 JSON Optimization</h2>
      <p style="color: #888; margin-bottom: 1rem;">
        Estimated savings from compression: <strong class="savings">${this.formatBytes(jsonSavings)}</strong>
      </p>
      
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Size</th>
            <th>Recommended Action</th>
          </tr>
        </thead>
        <tbody>
          ${jsonFiles.map(json => `
            <tr>
              <td>${path.basename(json.path)}</td>
              <td>${this.formatBytes(json.size)}</td>
              <td>${json.optimization.suggestedActions[0] || 'No optimization needed'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>🐌 Lazy Loading Strategy</h2>
      
      <h3 style="color: #ff6b6b; margin: 1rem 0;">Critical (Immediate)</h3>
      <ul>
        ${this.report.lazyLoadingStrategy.critical.map(item => `<li><code>${item}</code></li>`).join('')}
      </ul>

      <h3 style="color: #fdcb6e; margin: 1rem 0;">Deferred (After render)</h3>
      <ul>
        ${this.report.lazyLoadingStrategy.deferred.map(item => `<li><code>${item}</code></li>`).join('')}
      </ul>

      <h3 style="color: #00b894; margin: 1rem 0;">Lazy (On demand)</h3>
      <ul>
        ${this.report.lazyLoadingStrategy.lazy.map(item => `<li><code>${item}</code></li>`).join('')}
      </ul>
    </div>

    <div class="section">
      <h2>🎭 Sprite Atlas Recommendations</h2>
      ${this.report.spriteAtlases.length === 0 ? '<p>No sprite atlas candidates found.</p>' : ''}
      ${this.report.spriteAtlases.map(atlas => `
        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
          <h3>${atlas.name}</h3>
          <p>${atlas.sprites.length} sprites | ${atlas.dimensions.width}x${atlas.dimensions.height}px</p>
          <p>Estimated size: ${this.formatBytes(atlas.estimatedSize)}</p>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <h2>🛠️ Responsive Image Component</h2>
      <div class="code-block">
        <code>${this.escapeHtml(this.generateImageComponent())}</code>
      </div>
    </div>
  </div>

  <script>
    const ctx = document.getElementById('savingsChart').getContext('2d');
    new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Images', 'JSON', 'Other'],
        datasets: [{
          data: [${imageSavings}, ${jsonSavings}, ${this.report.totalPotentialSavings - imageSavings - jsonSavings}],
          backgroundColor: ['#ff6b6b', '#4ecdc4', '#ffeaa7'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#fff' }
          },
          title: {
            display: true,
            text: 'Potential Savings by Type',
            color: '#fff'
          }
        }
      }
    });
  </script>
</body>
</html>`;
  }

  private generateOptimizationScript(): string {
    const assetsDir = ASSETS_DIR;
    const outputDir = path.join(ROOT_DIR, 'dist', 'optimized-assets');
    const timestamp = new Date().toISOString();
    
    // Use string concatenation to avoid template literal conflicts with bash
    return '#!/bin/bash\n' +
      '# Asset Optimization Script for candy_world\n' +
      '# Generated: ' + timestamp + '\n\n' +
      'set -e\n\n' +
      'echo "🖼️ Optimizing assets..."\n\n' +
      'ASSETS_DIR="' + assetsDir + '"\n' +
      'OUTPUT_DIR="' + outputDir + '"\n\n' +
      'mkdir -p "$OUTPUT_DIR"\n\n' +
      '# Check for required tools\n' +
      'command -v cwebp >/dev/null 2>&1 || { echo "❌ cwebp not installed. Install with: apt install webp"; exit 1; }\n' +
      'command -v avifenc >/dev/null 2>&1 || echo "⚠️ avifenc not installed. AVIF generation skipped."\n\n' +
      '# Convert images to WebP\n' +
      'echo "Converting images to WebP..."\n' +
      'find "$ASSETS_DIR" -type f \\( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \\) | while read img; do\n' +
      '  filename=$(basename "$img")\n' +
      '  name="${filename%.*}"\n' +
      '  \n' +
      '  # WebP conversion\n' +
      '  cwebp -q 85 "$img" -o "$OUTPUT_DIR/${name}.webp"\n' +
      '  echo "  ✓ ${name}.webp"\n' +
      '  \n' +
      '  # AVIF conversion (if available)\n' +
      '  if command -v avifenc >/dev/null 2>&1; then\n' +
      '    avifenc -q 80 "$img" "$OUTPUT_DIR/${name}.avif"\n' +
      '    echo "  ✓ ${name}.avif"\n' +
      '  fi\n' +
      'done\n\n' +
      '# Minify JSON files\n' +
      'echo "Minifying JSON files..."\n' +
      'find "$ASSETS_DIR" -name "*.json" | while read json; do\n' +
      '  filename=$(basename "$json")\n' +
      '  cat "$json" | jq -c . > "$OUTPUT_DIR/$filename"\n' +
      '  echo "  ✓ $filename minified"\n' +
      'done\n\n' +
      'echo ""\n' +
      'echo "✅ Optimization complete!"\n' +
      'echo "   Output: $OUTPUT_DIR"\n' +
      'echo ""\n' +
      'echo "Compare sizes:"\n' +
      'du -sh "$ASSETS_DIR"\n' +
      'du -sh "$OUTPUT_DIR"\n';
  }

  private generateImageComponent(): string {
    return `<!-- ResponsiveImage.astro -->
---
export interface Props {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  loading?: 'eager' | 'lazy';
  decoding?: 'async' | 'sync' | 'auto';
  class?: string;
}

const { src, alt, width, height, loading = 'lazy', decoding = 'async', class: className } = Astro.props;

// Generate srcset for different formats
const baseName = src.replace(/\\.[^/.]+$/, '');
const webpSrc = baseName + '.webp';
const avifSrc = baseName + '.avif';
---

<picture>
  <!-- AVIF for modern browsers -->
  <source 
    srcset={avifSrc} 
    type="image/avif"
  />
  
  <!-- WebP for good browsers -->
  <source 
    srcset={webpSrc} 
    type="image/webp"
  />
  
  <!-- Fallback PNG/JPG -->
  <img
    src={src}
    alt={alt}
    width={width}
    height={height}
    loading={loading}
    decoding={decoding}
    class={className}
  />
</picture>

<style>
  picture, img {
    max-width: 100%;
    height: auto;
    display: block;
  }
</style>
`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : OUTPUT_FILE;
  
  const optimizer = new AssetOptimizer();
  
  try {
    const report = await optimizer.analyze();
    optimizer.generateReport(outputPath);
    
    console.log('\n📊 Summary:');
    console.log(`   Assets Analyzed: ${report.assets.length}`);
    console.log(`   Current Size: ${(report.totalCurrentSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Potential Savings: ${(report.totalPotentialSavings / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Optimizable Assets: ${report.assets.filter(a => a.optimization.canOptimize).length}`);
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  }
}

main();
