#!/usr/bin/env tsx
/**
 * Bundle Analyzer for candy_world
 * 
 * Generates Webpack-style bundle visualization with treemap
 * Identifies largest dependencies and duplicate code across chunks
 * 
 * Usage: tsx bundle-analyzer.ts [--output ./stats/bundle-analysis.html]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const BUILD_DIR = path.join(ROOT_DIR, 'dist');
const STATS_DIR = path.join(__dirname, '../stats');
const OUTPUT_FILE = path.join(STATS_DIR, 'bundle-analysis.html');

// Color palette for visualization
const COLORS = {
  threejs: '#ff6b6b',
  wasm: '#4ecdc4',
  shaders: '#45b7d1',
  audio: '#96ceb4',
  foliage: '#ffeaa7',
  utils: '#dfe6e9',
  core: '#74b9ff',
  vendor: '#a29bfe',
  other: '#b2bec3'
};

interface FileInfo {
  path: string;
  size: number;
  gzipSize: number;
  brotliSize: number;
  category: string;
  content?: string;
}

interface ChunkInfo {
  name: string;
  size: number;
  gzipSize: number;
  brotliSize: number;
  files: FileInfo[];
  imports: string[];
  exports: string[];
}

interface BundleStats {
  totalSize: number;
  totalGzip: number;
  totalBrotli: number;
  chunks: ChunkInfo[];
  dependencies: Map<string, number>;
  duplicates: DuplicateInfo[];
}

interface DuplicateInfo {
  content: string;
  size: number;
  occurrences: string[];
  savings: number;
}

class BundleAnalyzer {
  private stats: BundleStats = {
    totalSize: 0,
    totalGzip: 0,
    totalBrotli: 0,
    chunks: [],
    dependencies: new Map(),
    duplicates: []
  };

  async analyze(): Promise<BundleStats> {
    console.log('🔍 Analyzing bundle...');
    
    // Check if dist exists, if not analyze source files
    const targetDir = fs.existsSync(BUILD_DIR) ? BUILD_DIR : path.join(ROOT_DIR, 'src');
    
    await this.scanDirectory(targetDir);
    await this.findDuplicates();
    await this.analyzeDependencies();
    
    return this.stats;
  }

  private async scanDirectory(dir: string, relativePath = ''): Promise<void> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);
      
      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath, relPath);
      } else {
        await this.analyzeFile(fullPath, relPath);
      }
    }
  }

  private async analyzeFile(fullPath: string, relPath: string): Promise<void> {
    const ext = path.extname(fullPath);
    const content = fs.readFileSync(fullPath);
    const size = content.length;
    
    // Simple gzip/brotli estimation
    const gzipSize = Math.floor(size * 0.3); // ~30% of original
    const brotliSize = Math.floor(size * 0.25); // ~25% of original
    
    const category = this.categorizeFile(relPath, content.toString());
    
    const fileInfo: FileInfo = {
      path: relPath,
      size,
      gzipSize,
      brotliSize,
      category,
      content: size < 1024 * 1024 ? content.toString() : undefined // Skip content for large files
    };
    
    // Find or create chunk
    const chunkName = this.getChunkName(relPath);
    let chunk = this.stats.chunks.find(c => c.name === chunkName);
    
    if (!chunk) {
      chunk = {
        name: chunkName,
        size: 0,
        gzipSize: 0,
        brotliSize: 0,
        files: [],
        imports: [],
        exports: []
      };
      this.stats.chunks.push(chunk);
    }
    
    chunk.files.push(fileInfo);
    chunk.size += size;
    chunk.gzipSize += gzipSize;
    chunk.brotliSize += brotliSize;
    
    this.stats.totalSize += size;
    this.stats.totalGzip += gzipSize;
    this.stats.totalBrotli += brotliSize;
  }

  private categorizeFile(filePath: string, content: string): string {
    const lowerPath = filePath.toLowerCase();
    
    if (lowerPath.includes('three') || content.includes('from \'three\'') || content.includes('from "three"')) {
      return 'threejs';
    }
    if (lowerPath.endsWith('.wasm') || lowerPath.includes('wasm')) {
      return 'wasm';
    }
    if (lowerPath.endsWith('.glsl') || lowerPath.endsWith('.wgsl') || lowerPath.includes('shader') || content.includes('tsl')) {
      return 'shaders';
    }
    if (lowerPath.includes('audio') || lowerPath.includes('sound') || lowerPath.includes('music')) {
      return 'audio';
    }
    if (lowerPath.includes('foliage') || lowerPath.includes('tree') || lowerPath.includes('flower')) {
      return 'foliage';
    }
    if (lowerPath.includes('utils') || lowerPath.includes('helper')) {
      return 'utils';
    }
    if (lowerPath.includes('core') || lowerPath.includes('main.ts') || lowerPath.includes('index.ts')) {
      return 'core';
    }
    if (lowerPath.includes('node_modules')) {
      return 'vendor';
    }
    
    return 'other';
  }

  private getChunkName(filePath: string): string {
    if (filePath.includes('node_modules')) {
      return 'vendor';
    }
    if (filePath.includes('wasm') || filePath.endsWith('.wasm')) {
      return 'wasm';
    }
    if (filePath.includes('foliage')) {
      return 'foliage';
    }
    if (filePath.includes('audio')) {
      return 'audio';
    }
    if (filePath.includes('rendering') || filePath.includes('shader')) {
      return 'shaders';
    }
    if (filePath.includes('main') || filePath.includes('index')) {
      return 'main';
    }
    
    // Group by directory
    const parts = filePath.split('/');
    if (parts.length > 1) {
      return parts[0];
    }
    
    return 'main';
  }

  private async findDuplicates(): Promise<void> {
    console.log('  📦 Finding duplicate code...');
    
    const contentMap = new Map<string, string[]>();
    
    // Collect all file contents
    for (const chunk of this.stats.chunks) {
      for (const file of chunk.files) {
        if (!file.content) continue;
        
        // Look for common patterns that might be duplicated
        const patterns = this.extractPatterns(file.content);
        
        for (const pattern of patterns) {
          const hash = this.simpleHash(pattern);
          const existing = contentMap.get(hash) || [];
          existing.push(file.path);
          contentMap.set(hash, existing);
        }
      }
    }
    
    // Find duplicates (>100 bytes, occurring in multiple files)
    for (const [hash, files] of contentMap.entries()) {
      if (files.length > 1 && hash.length > 100) {
        this.stats.duplicates.push({
          content: hash.substring(0, 200),
          size: hash.length,
          occurrences: [...new Set(files)],
          savings: hash.length * (files.length - 1)
        });
      }
    }
    
    // Sort by potential savings
    this.stats.duplicates.sort((a, b) => b.savings - a.savings);
  }

  private extractPatterns(content: string): string[] {
    const patterns: string[] = [];
    
    // Extract function definitions
    const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*\{[^}]*\}/g;
    let match;
    while ((match = functionRegex.exec(content)) !== null) {
      patterns.push(match[0]);
    }
    
    // Extract class definitions
    const classRegex = /(?:export\s+)?class\s+\w+[^}]*\{[^}]*\}/g;
    while ((match = classRegex.exec(content)) !== null) {
      patterns.push(match[0]);
    }
    
    // Extract constant objects
    const constRegex = /(?:export\s+)?const\s+\w+\s*=\s*\{[^}]*\}/g;
    while ((match = constRegex.exec(content)) !== null) {
      patterns.push(match[0]);
    }
    
    return patterns;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private async analyzeDependencies(): Promise<void> {
    console.log('  🔗 Analyzing dependencies...');
    
    for (const chunk of this.stats.chunks) {
      for (const file of chunk.files) {
        if (!file.content) continue;
        
        // Extract imports
        const importRegex = /from\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(file.content)) !== null) {
          const dep = match[1];
          const currentSize = this.stats.dependencies.get(dep) || 0;
          this.stats.dependencies.set(dep, currentSize + file.size);
        }
      }
    }
  }

  generateReport(outputPath: string = OUTPUT_FILE): void {
    console.log(`  📝 Generating report: ${outputPath}`);
    
    const html = this.generateHTML();
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, html);
    console.log(`  ✅ Report saved: ${outputPath}`);
  }

  private generateHTML(): string {
    const largestDeps = [...this.stats.dependencies.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    
    const topDuplicates = this.stats.duplicates.slice(0, 10);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>candy_world Bundle Analysis</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
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
      background: linear-gradient(90deg, #ff6b6b, #4ecdc4);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-top: 1.5rem;
    }
    .stat-card {
      background: rgba(255,255,255,0.05);
      padding: 1.5rem;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .stat-value {
      font-size: 2rem;
      font-weight: bold;
      color: #4ecdc4;
    }
    .stat-label {
      color: #888;
      font-size: 0.9rem;
      margin-top: 0.25rem;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }
    .section {
      background: rgba(255,255,255,0.03);
      border-radius: 16px;
      padding: 2rem;
      margin-bottom: 2rem;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .section h2 {
      margin-bottom: 1.5rem;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    #treemap {
      width: 100%;
      height: 500px;
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
    }
    .treemap-cell {
      stroke: #0a0a0f;
      stroke-width: 2;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .treemap-cell:hover {
      opacity: 0.8;
      stroke: #fff;
    }
    .treemap-label {
      font-size: 12px;
      fill: #fff;
      pointer-events: none;
      text-shadow: 0 1px 2px rgba(0,0,0,0.8);
    }
    .tooltip {
      position: absolute;
      background: rgba(0,0,0,0.9);
      color: #fff;
      padding: 1rem;
      border-radius: 8px;
      font-size: 13px;
      pointer-events: none;
      border: 1px solid rgba(255,255,255,0.2);
      max-width: 300px;
      z-index: 1000;
    }
    .dependency-list {
      display: grid;
      gap: 0.75rem;
    }
    .dependency-item {
      display: flex;
      align-items: center;
      padding: 1rem;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      border-left: 4px solid;
    }
    .dep-name {
      flex: 1;
      font-family: 'SF Mono', monospace;
      font-size: 0.9rem;
    }
    .dep-size {
      color: #4ecdc4;
      font-weight: bold;
    }
    .duplicate-item {
      padding: 1rem;
      background: rgba(255,107,107,0.1);
      border-radius: 8px;
      border-left: 4px solid #ff6b6b;
      margin-bottom: 1rem;
    }
    .duplicate-files {
      font-size: 0.85rem;
      color: #888;
      margin-top: 0.5rem;
    }
    .savings {
      color: #ffeaa7;
      font-weight: bold;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      margin-top: 1rem;
      padding: 1rem;
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.85rem;
    }
    .legend-color {
      width: 16px;
      height: 16px;
      border-radius: 4px;
    }
    pre {
      background: rgba(0,0,0,0.5);
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🍭 candy_world Bundle Analysis</h1>
    <p>Comprehensive bundle visualization and optimization report</p>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${this.formatBytes(this.stats.totalSize)}</div>
        <div class="stat-label">Total Size</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${this.formatBytes(this.stats.totalGzip)}</div>
        <div class="stat-label">Gzipped</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${this.formatBytes(this.stats.totalBrotli)}</div>
        <div class="stat-label">Brotli</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${this.stats.chunks.length}</div>
        <div class="stat-label">Chunks</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${this.stats.duplicates.length}</div>
        <div class="stat-label">Duplicates Found</div>
      </div>
    </div>
  </div>

  <div class="container">
    <div class="section">
      <h2>📊 Bundle Treemap</h2>
      <div id="treemap"></div>
      <div class="legend">
        ${Object.entries(COLORS).map(([name, color]) => `
          <div class="legend-item">
            <div class="legend-color" style="background: ${color}"></div>
            <span>${name}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="section">
      <h2>📦 Largest Dependencies</h2>
      <div class="dependency-list">
        ${largestDeps.map(([dep, size]) => `
          <div class="dependency-item" style="border-color: ${this.getCategoryColor(dep)}">
            <span class="dep-name">${dep}</span>
            <span class="dep-size">${this.formatBytes(size)}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="section">
      <h2>⚠️ Duplicate Code Detection</h2>
      ${topDuplicates.length === 0 ? '<p>No significant duplicates found. Great job!</p>' : ''}
      ${topDuplicates.map(dup => `
        <div class="duplicate-item">
          <div>Potential savings: <span class="savings">${this.formatBytes(dup.savings)}</span></div>
          <div class="duplicate-files">Found in: ${dup.occurrences.join(', ')}</div>
          <pre>${dup.content.substring(0, 200)}...</pre>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <h2>📈 Chunk Breakdown</h2>
      ${this.stats.chunks.map(chunk => `
        <div style="margin-bottom: 1.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h3>${chunk.name}</h3>
            <span style="color: #4ecdc4; font-weight: bold;">${this.formatBytes(chunk.size)}</span>
          </div>
          <div style="background: rgba(0,0,0,0.3); height: 8px; border-radius: 4px; margin-top: 0.5rem;">
            <div style="background: ${this.getCategoryColor(chunk.name)}; width: ${(chunk.size / this.stats.totalSize * 100).toFixed(1)}%; height: 100%; border-radius: 4px;"></div>
          </div>
          <div style="color: #888; font-size: 0.85rem; margin-top: 0.5rem;">
            ${chunk.files.length} files | Gzip: ${this.formatBytes(chunk.gzipSize)} | Brotli: ${this.formatBytes(chunk.brotliSize)}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <h2>💡 Optimization Recommendations</h2>
      <div style="display: grid; gap: 1rem;">
        ${this.generateRecommendations().map(rec => `
          <div style="padding: 1rem; background: rgba(78,205,196,0.1); border-radius: 8px; border-left: 4px solid #4ecdc4;">
            <strong>${rec.title}</strong>
            <p style="color: #aaa; margin-top: 0.5rem;">${rec.description}</p>
            <div style="color: #ffeaa7; font-size: 0.9rem; margin-top: 0.5rem;">
              Impact: ${rec.impact} | Effort: ${rec.effort}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  </div>

  <div class="tooltip" id="tooltip" style="display: none;"></div>

  <script>
    // Treemap data
    const data = ${JSON.stringify(this.stats.chunks.map(chunk => ({
      name: chunk.name,
      value: chunk.size,
      category: chunk.files[0]?.category || 'other',
      children: chunk.files.map(f => ({
        name: f.path.split('/').pop(),
        value: f.size,
        category: f.category,
        fullPath: f.path
      }))
    })))};

    // Create treemap
    const width = document.getElementById('treemap').clientWidth;
    const height = 500;
    const colorScale = ${JSON.stringify(COLORS)};

    const root = d3.hierarchy({children: data.flatMap(d => d.children.map(c => ({...c, parent: d.name})))})
      .sum(d => d.value)
      .sort((a, b) => b.value - a.value);

    d3.treemap()
      .size([width, height])
      .padding(2)
      (root);

    const svg = d3.select('#treemap')
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const tooltip = d3.select('#tooltip');

    const leaf = svg.selectAll('g')
      .data(root.leaves())
      .join('g')
      .attr('transform', d => \`translate(\${d.x0},\${d.y0})\`);

    leaf.append('rect')
      .attr('class', 'treemap-cell')
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0)
      .attr('fill', d => colorScale[d.data.category] || colorScale.other)
      .on('mouseover', function(event, d) {
        tooltip
          .style('display', 'block')
          .html(\`
            <strong>\${d.data.name}</strong><br/>
            Path: \${d.data.fullPath}<br/>
            Size: \${(d.data.value / 1024).toFixed(2)} KB<br/>
            Category: \${d.data.category}
          \`);
      })
      .on('mousemove', function(event) {
        tooltip
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 10) + 'px');
      })
      .on('mouseout', function() {
        tooltip.style('display', 'none');
      });

    // Add labels for large cells
    leaf.filter(d => (d.x1 - d.x0) > 60 && (d.y1 - d.y0) > 30)
      .append('text')
      .attr('class', 'treemap-label')
      .attr('x', 4)
      .attr('y', 16)
      .text(d => d.data.name.length > 20 ? d.data.name.substring(0, 20) + '...' : d.data.name);
  </script>
</body>
</html>`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private getCategoryColor(category: string): string {
    return COLORS[category as keyof typeof COLORS] || COLORS.other;
  }

  private generateRecommendations(): Array<{title: string, description: string, impact: string, effort: string}> {
    const recommendations = [];
    
    // Check for Three.js size
    const threeSize = this.stats.dependencies.get('three') || 0;
    if (threeSize > 500 * 1024) {
      recommendations.push({
        title: 'Optimize Three.js Import',
        description: 'Three.js is large. Consider using tree-shakable imports (import * as THREE from "three") or switching to three-min if features allow.',
        impact: 'High',
        effort: 'Medium'
      });
    }
    
    // Check for duplicate code
    if (this.stats.duplicates.length > 0) {
      const totalSavings = this.stats.duplicates.reduce((sum, d) => sum + d.savings, 0);
      recommendations.push({
        title: 'Eliminate Duplicate Code',
        description: `Found ${this.stats.duplicates.length} duplicate patterns. Extract to shared utilities for ${this.formatBytes(totalSavings)} savings.`,
        impact: 'Medium',
        effort: 'Low'
      });
    }
    
    // Check chunk count
    if (this.stats.chunks.length > 10) {
      recommendations.push({
        title: 'Consolidate Small Chunks',
        description: `You have ${this.stats.chunks.length} chunks. Consider merging chunks under 50KB to reduce HTTP requests.`,
        impact: 'Medium',
        effort: 'Low'
      });
    }
    
    // WASM optimization
    const wasmChunk = this.stats.chunks.find(c => c.name === 'wasm');
    if (wasmChunk && wasmChunk.size > 200 * 1024) {
      recommendations.push({
        title: 'Optimize WASM Bundle',
        description: 'WASM files are large. Enable wasm-opt (Binaryen) with -O3 -s for production builds.',
        impact: 'High',
        effort: 'Low'
      });
    }
    
    // Shaders
    const shaderChunk = this.stats.chunks.find(c => c.name === 'shaders');
    if (shaderChunk && shaderChunk.size > 100 * 1024) {
      recommendations.push({
        title: 'Precompile Shaders',
        description: 'Shaders are compiled at runtime. Precompile and cache shader programs to reduce startup time.',
        impact: 'Medium',
        effort: 'Medium'
      });
    }
    
    // Asset optimization
    if (this.stats.totalSize > 2 * 1024 * 1024) {
      recommendations.push({
        title: 'Implement Lazy Loading',
        description: 'Bundle exceeds 2MB. Use dynamic imports for non-critical features like editor, debug tools, and secondary foliage.',
        impact: 'High',
        effort: 'Medium'
      });
    }
    
    return recommendations;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : OUTPUT_FILE;
  
  const analyzer = new BundleAnalyzer();
  
  try {
    await analyzer.analyze();
    analyzer.generateReport(outputPath);
    
    console.log('\n📊 Summary:');
    console.log(`   Total Size: ${analyzer['stats'].totalSize.toLocaleString()} bytes`);
    console.log(`   Chunks: ${analyzer['stats'].chunks.length}`);
    console.log(`   Duplicates: ${analyzer['stats'].duplicates.length}`);
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  }
}

main();
