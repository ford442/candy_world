#!/usr/bin/env tsx
/**
 * Compression Benchmark for candy_world
 * 
 * Compares gzip, brotli, and zstd compression strategies
 * Generates optimal server config snippets
 * Calculates bandwidth savings
 * 
 * Usage: tsx compression-benchmark.ts [--output ./stats/compression-report.html]
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const STATS_DIR = path.join(__dirname, '../stats');
const OUTPUT_FILE = path.join(STATS_DIR, 'compression-report.html');

// Connection speed estimates (bytes per second)
const CONNECTION_SPEEDS = {
  '3G': 750 * 1024 / 8,      // 750 kbps
  '4G': 50 * 1024 * 1024 / 8, // 50 Mbps
  '5G': 500 * 1024 * 1024 / 8 // 500 Mbps
};

interface CompressionResult {
  algorithm: 'gzip' | 'brotli' | 'zstd' | 'none';
  size: number;
  ratio: number;
  time: number;
}

interface FileResult {
  path: string;
  originalSize: number;
  type: string;
  compressions: CompressionResult[];
  bestAlgorithm: string;
  savingsVsNone: number;
}

interface BenchmarkReport {
  timestamp: string;
  files: FileResult[];
  summary: {
    totalOriginalSize: number;
    bestCompressionByType: Map<string, string>;
    estimatedLoadTimes: Map<string, number>;
    annualBandwidthSavings: number;
  };
  serverConfigs: {
    nginx: string;
    apache: string;
    vercel: string;
    netlify: string;
  };
}

class CompressionBenchmark {
  private report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    files: [],
    summary: {
      totalOriginalSize: 0,
      bestCompressionByType: new Map(),
      estimatedLoadTimes: new Map(),
      annualBandwidthSavings: 0
    },
    serverConfigs: {
      nginx: '',
      apache: '',
      vercel: '',
      netlify: ''
    }
  };

  private hasGzip = false;
  private hasBrotli = false;
  private hasZstd = false;

  async benchmark(): Promise<BenchmarkReport> {
    console.log('📊 Running compression benchmarks...');
    
    // Check available compression tools
    this.checkTools();
    
    // Find files to benchmark
    const files = this.findFiles();
    console.log(`  Found ${files.length} files to benchmark`);
    
    // Benchmark each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`  [${i + 1}/${files.length}] ${path.basename(file)}`);
      
      const result = await this.benchmarkFile(file);
      if (result) {
        this.report.files.push(result);
        this.report.summary.totalOriginalSize += result.originalSize;
      }
    }
    
    // Generate summary
    this.generateSummary();
    
    // Generate server configs
    this.generateServerConfigs();
    
    return this.report;
  }

  private checkTools(): void {
    console.log('  🔧 Checking compression tools...');
    
    try {
      execSync('gzip --version', { stdio: 'pipe' });
      this.hasGzip = true;
      console.log('    ✅ gzip available');
    } catch {
      console.log('    ⚠️ gzip not available');
    }
    
    try {
      execSync('brotli --version', { stdio: 'pipe' });
      this.hasBrotli = true;
      console.log('    ✅ brotli available');
    } catch {
      console.log('    ⚠️ brotli not available (using Node.js fallback)');
    }
    
    try {
      execSync('zstd --version', { stdio: 'pipe' });
      this.hasZstd = true;
      console.log('    ✅ zstd available');
    } catch {
      console.log('    ⚠️ zstd not available');
    }
  }

  private findFiles(): string[] {
    const files: string[] = [];
    const targetDir = fs.existsSync(DIST_DIR) ? DIST_DIR : path.join(ROOT_DIR, 'src');
    const assetsDir = path.join(ROOT_DIR, 'assets');
    
    // Scan dist or src
    this.scanDirectory(targetDir, files);
    
    // Also scan assets
    if (fs.existsSync(assetsDir)) {
      this.scanDirectory(assetsDir, files);
    }
    
    // Filter to relevant file types
    return files.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.js', '.ts', '.css', '.html', '.json', '.wasm', '.png', '.jpg', '.svg'].includes(ext);
    }).slice(0, 50); // Limit to 50 files for performance
  }

  private scanDirectory(dir: string, files: string[]): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory() && !entry.name.includes('node_modules')) {
        this.scanDirectory(fullPath, files);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  private async benchmarkFile(filePath: string): Promise<FileResult | null> {
    const content = fs.readFileSync(filePath);
    const originalSize = content.length;
    const type = this.getFileType(filePath);
    
    // Skip very small files
    if (originalSize < 100) return null;
    
    const compressions: CompressionResult[] = [];
    
    // No compression baseline
    compressions.push({
      algorithm: 'none',
      size: originalSize,
      ratio: 1,
      time: 0
    });
    
    // Gzip
    if (this.hasGzip) {
      const gzipResult = await this.compressGzip(content);
      compressions.push(gzipResult);
    }
    
    // Brotli
    const brotliResult = await this.compressBrotli(content);
    compressions.push(brotliResult);
    
    // Zstd
    if (this.hasZstd) {
      const zstdResult = await this.compressZstd(content);
      compressions.push(zstdResult);
    }
    
    // Find best algorithm
    const validCompressions = compressions.filter(c => c.size > 0);
    const best = validCompressions.reduce((a, b) => a.size < b.size ? a : b);
    
    return {
      path: path.relative(ROOT_DIR, filePath),
      originalSize,
      type,
      compressions,
      bestAlgorithm: best.algorithm,
      savingsVsNone: originalSize - best.size
    };
  }

  private async compressGzip(content: Buffer): Promise<CompressionResult> {
    const start = performance.now();
    
    try {
      const result = execSync('gzip -9 -c', { input: content, encoding: 'buffer' });
      const time = performance.now() - start;
      
      return {
        algorithm: 'gzip',
        size: result.length,
        ratio: result.length / content.length,
        time
      };
    } catch {
      // Fallback to Node.js zlib
      const zlib = await import('zlib');
      const compressed = zlib.gzipSync(content, { level: 9 });
      const time = performance.now() - start;
      
      return {
        algorithm: 'gzip',
        size: compressed.length,
        ratio: compressed.length / content.length,
        time
      };
    }
  }

  private async compressBrotli(content: Buffer): Promise<CompressionResult> {
    const start = performance.now();
    
    if (this.hasBrotli) {
      try {
        const result = execSync('brotli -q 11 -c', { input: content, encoding: 'buffer' });
        const time = performance.now() - start;
        
        return {
          algorithm: 'brotli',
          size: result.length,
          ratio: result.length / content.length,
          time
        };
      } catch {
        // Fall through to Node.js implementation
      }
    }
    
    // Node.js fallback
    const zlib = await import('zlib');
    const compressed = zlib.brotliCompressSync(content, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11
      }
    });
    const time = performance.now() - start;
    
    return {
      algorithm: 'brotli',
      size: compressed.length,
      ratio: compressed.length / content.length,
      time
    };
  }

  private async compressZstd(content: Buffer): Promise<CompressionResult> {
    const start = performance.now();
    
    try {
      const result = execSync('zstd -19 -c', { input: content, encoding: 'buffer' });
      const time = performance.now() - start;
      
      return {
        algorithm: 'zstd',
        size: result.length,
        ratio: result.length / content.length,
        time
      };
    } catch {
      return {
        algorithm: 'zstd',
        size: 0,
        ratio: 0,
        time: 0
      };
    }
  }

  private getFileType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const types: Record<string, string> = {
      '.js': 'JavaScript',
      '.ts': 'TypeScript',
      '.css': 'CSS',
      '.html': 'HTML',
      '.json': 'JSON',
      '.wasm': 'WASM',
      '.png': 'PNG Image',
      '.jpg': 'JPEG Image',
      '.svg': 'SVG Image'
    };
    return types[ext] || 'Other';
  }

  private generateSummary(): void {
    console.log('  📈 Generating summary...');
    
    // Best compression by file type
    const typeStats = new Map<string, Map<string, number>>();
    
    for (const file of this.report.files) {
      if (!typeStats.has(file.type)) {
        typeStats.set(file.type, new Map());
      }
      
      const algoStats = typeStats.get(file.type)!;
      for (const comp of file.compressions) {
        const current = algoStats.get(comp.algorithm) || 0;
        algoStats.set(comp.algorithm, current + comp.size);
      }
    }
    
    for (const [type, algos] of typeStats) {
      let bestAlgo = 'none';
      let bestSize = Infinity;
      
      for (const [algo, size] of algos) {
        if (size > 0 && size < bestSize) {
          bestSize = size;
          bestAlgo = algo;
        }
      }
      
      this.report.summary.bestCompressionByType.set(type, bestAlgo);
    }
    
    // Calculate load times
    const bestTotalSize = this.report.files.reduce((sum, f) => {
      const best = f.compressions.reduce((a, b) => a.size < b.size ? a : b);
      return sum + best.size;
    }, 0);
    
    for (const [speedName, speed] of Object.entries(CONNECTION_SPEEDS)) {
      const loadTime = bestTotalSize / speed;
      this.report.summary.estimatedLoadTimes.set(speedName, loadTime);
    }
    
    // Calculate bandwidth savings (assuming 1000 visits/day)
    const uncompressedTotal = this.report.files.reduce((sum, f) => sum + f.originalSize, 0);
    const dailyVisits = 1000;
    const dailySavings = (uncompressedTotal - bestTotalSize) * dailyVisits;
    this.report.summary.annualBandwidthSavings = dailySavings * 365;
  }

  private generateServerConfigs(): void {
    // Nginx config
    this.report.serverConfigs.nginx = `# Nginx Compression Configuration
# Add to your server block

# Enable gzip
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_min_length 1000;
gzip_types
    text/plain
    text/css
    text/xml
    text/javascript
    application/json
    application/javascript
    application/xml+rss
    application/atom+xml
    image/svg+xml
    font/woff
    font/woff2;

# Enable Brotli (requires ngx_brotli module)
brotli on;
brotli_comp_level 6;
brotli_min_length 1000;
brotli_types
    text/plain
    text/css
    text/xml
    text/javascript
    application/json
    application/javascript
    application/xml+rss
    application/atom+xml
    image/svg+xml
    font/woff
    font/woff2;
`;

    // Apache config
    this.report.serverConfigs.apache = `# Apache Compression Configuration
# Add to your .htaccess or virtual host config

# Enable mod_deflate
<IfModule mod_deflate.c>
    # Compress HTML, CSS, JavaScript, Text, XML, fonts
    AddOutputFilterByType DEFLATE application/javascript
    AddOutputFilterByType DEFLATE application/rss+xml
    AddOutputFilterByType DEFLATE application/vnd.ms-fontobject
    AddOutputFilterByType DEFLATE application/x-font
    AddOutputFilterByType DEFLATE application/x-font-opentype
    AddOutputFilterByType DEFLATE application/x-font-otf
    AddOutputFilterByType DEFLATE application/x-font-truetype
    AddOutputFilterByType DEFLATE application/x-font-ttf
    AddOutputFilterByType DEFLATE application/x-javascript
    AddOutputFilterByType DEFLATE application/xhtml+xml
    AddOutputFilterByType DEFLATE application/xml
    AddOutputFilterByType DEFLATE font/opentype
    AddOutputFilterByType DEFLATE font/otf
    AddOutputFilterByType DEFLATE font/ttf
    AddOutputFilterByType DEFLATE image/svg+xml
    AddOutputFilterByType DEFLATE image/x-icon
    AddOutputFilterByType DEFLATE text/css
    AddOutputFilterByType DEFLATE text/html
    AddOutputFilterByType DEFLATE text/javascript
    AddOutputFilterByType DEFLATE text/plain
    AddOutputFilterByType DEFLATE text/xml
    
    # Remove browser bugs
    BrowserMatch ^Mozilla/4 gzip-only-text/html
    BrowserMatch ^Mozilla/4\\.0[678] no-gzip
    BrowserMatch \\bMSIE !no-gzip !gzip-only-text/html
</IfModule>

# Enable mod_brotli (Apache 2.4.26+)
<IfModule mod_brotli.c>
    AddOutputFilterByType BROTLI_COMPRESS text/html text/plain text/xml text/css text/javascript application/javascript application/json
</IfModule>
`;

    // Vercel config
    this.report.serverConfigs.vercel = `{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}

# Note: Vercel automatically handles Brotli and Gzip compression
# No additional configuration needed
`;

    // Netlify config
    this.report.serverConfigs.netlify = `# netlify.toml

[build]
  command = "npm run build"
  publish = "dist"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-XSS-Protection = "1; mode=block"
    
# Netlify automatically compresses assets with Brotli and Gzip
# For custom compression settings, use build plugins
`;
  }

  generateReport(outputPath: string = OUTPUT_FILE): void {
    console.log(`  📝 Generating report: ${outputPath}`);
    
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write JSON report
    const jsonPath = outputPath.replace('.html', '.json');
    fs.writeFileSync(jsonPath, JSON.stringify(this.report, null, 2));
    
    // Write HTML report
    fs.writeFileSync(outputPath, this.generateHTML());
    
    // Write server config files
    const configDir = path.join(outputDir, 'configs');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    fs.writeFileSync(path.join(configDir, 'nginx.conf'), this.report.serverConfigs.nginx);
    fs.writeFileSync(path.join(configDir, 'apache.htaccess'), this.report.serverConfigs.apache);
    fs.writeFileSync(path.join(configDir, 'vercel.json'), this.report.serverConfigs.vercel);
    fs.writeFileSync(path.join(configDir, 'netlify.toml'), this.report.serverConfigs.netlify);
    
    console.log(`  ✅ Reports saved:`);
    console.log(`     HTML: ${outputPath}`);
    console.log(`     JSON: ${jsonPath}`);
    console.log(`     Configs: ${configDir}/`);
  }

  private generateHTML(): string {
    const algorithms = ['none', 'gzip', 'brotli', 'zstd'];
    const colors = {
      none: '#666',
      gzip: '#4ecdc4',
      brotli: '#ff6b6b',
      zstd: '#ffeaa7'
    };
    
    // Calculate totals by algorithm
    const totals = new Map<string, number>();
    for (const algo of algorithms) {
      totals.set(algo, this.report.files.reduce((sum, f) => {
        const comp = f.compressions.find(c => c.algorithm === algo);
        return sum + (comp?.size || 0);
      }, 0));
    }
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>candy_world Compression Benchmark</title>
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
      background: linear-gradient(90deg, #4ecdc4, #ff6b6b);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
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
    }
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
    .stat-value {
      font-size: 1.75rem;
      font-weight: bold;
    }
    .stat-label {
      color: #888;
      font-size: 0.9rem;
      margin-top: 0.25rem;
    }
    .compression-card {
      border-left: 4px solid;
      margin-bottom: 1rem;
    }
    .compression-card.none { border-color: #666; }
    .compression-card.gzip { border-color: #4ecdc4; }
    .compression-card.brotli { border-color: #ff6b6b; }
    .compression-card.zstd { border-color: #ffeaa7; }
    
    .chart-container {
      position: relative;
      height: 400px;
      margin: 2rem 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
    }
    th, td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    th {
      color: #888;
      font-weight: 500;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-best { background: #00b894; color: #fff; }
    .badge-good { background: #0984e3; color: #fff; }
    .badge-ok { background: #fdcb6e; color: #000; }
    .config-block {
      background: rgba(0,0,0,0.5);
      padding: 1.5rem;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1rem 0;
    }
    .config-block pre {
      margin: 0;
      font-family: 'SF Mono', monospace;
      font-size: 0.85rem;
      line-height: 1.5;
    }
    .config-tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .config-tab {
      padding: 0.5rem 1rem;
      background: rgba(255,255,255,0.1);
      border: none;
      border-radius: 6px;
      color: #fff;
      cursor: pointer;
      transition: background 0.2s;
    }
    .config-tab:hover, .config-tab.active {
      background: rgba(255,255,255,0.2);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📊 Compression Benchmark Report</h1>
    <p style="color: #888; margin-top: 0.5rem;">Generated: ${new Date(this.report.timestamp).toLocaleString()}</p>
  </div>

  <div class="container">
    <div class="section">
      <h2>Summary</h2>
      <div class="stats-grid">
        ${algorithms.map(algo => {
          const size = totals.get(algo) || 0;
          const original = totals.get('none') || 1;
          const savings = original - size;
          const percentage = ((savings / original) * 100).toFixed(1);
          return `
            <div class="stat-card compression-card ${algo}">
              <div class="stat-value" style="color: ${colors[algo as keyof typeof colors]}">${this.formatBytes(size)}</div>
              <div class="stat-label">${algo.toUpperCase()}</div>
              ${algo !== 'none' ? `<div style="color: #00b894; font-size: 0.85rem; margin-top: 0.5rem;">-${percentage}% savings</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>

      <div class="chart-container">
        <canvas id="compressionChart"></canvas>
      </div>
    </div>

    <div class="section">
      <h2>⏱️ Estimated Load Times</h2>
      <div class="stats-grid">
        ${Array.from(this.report.summary.estimatedLoadTimes.entries()).map(([speed, time]) => `
          <div class="stat-card">
            <div class="stat-value" style="color: ${time < 3 ? '#00b894' : time < 10 ? '#fdcb6e' : '#ff6b6b'}">${time.toFixed(2)}s</div>
            <div class="stat-label">${speed}</div>
          </div>
        `).join('')}
      </div>
      <p style="color: #888; margin-top: 1rem;">
        Based on ${this.formatBytes(totals.get('brotli') || totals.get('gzip') || 0)} total compressed size
        and simulated connection speeds.
      </p>
    </div>

    <div class="section">
      <h2>💰 Bandwidth Savings</h2>
      <div class="stat-card">
        <div class="stat-value" style="color: #00b894;">${this.formatBytes(this.report.summary.annualBandwidthSavings)}</div>
        <div class="stat-label">Annual Bandwidth Savings (1000 visits/day)</div>
      </div>
    </div>

    <div class="section">
      <h2>📁 File Results</h2>
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Type</th>
            <th>Original</th>
            <th>Gzip</th>
            <th>Brotli</th>
            <th>Best</th>
          </tr>
        </thead>
        <tbody>
          ${this.report.files.slice(0, 30).map(file => {
            const gzip = file.compressions.find(c => c.algorithm === 'gzip');
            const brotli = file.compressions.find(c => c.algorithm === 'brotli');
            return `
              <tr>
                <td>${file.path.split('/').pop()}</td>
                <td><span class="badge badge-ok">${file.type}</span></td>
                <td>${this.formatBytes(file.originalSize)}</td>
                <td>${gzip ? `${this.formatBytes(gzip.size)} (${((1 - gzip.ratio) * 100).toFixed(0)}%)` : '-'}</td>
                <td>${brotli ? `${this.formatBytes(brotli.size)} (${((1 - brotli.ratio) * 100).toFixed(0)}%)` : '-'}</td>
                <td><span class="badge badge-best">${file.bestAlgorithm.toUpperCase()}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>⚙️ Server Configuration</h2>
      
      <div class="config-tabs">
        <button class="config-tab active" onclick="showConfig('nginx')">Nginx</button>
        <button class="config-tab" onclick="showConfig('apache')">Apache</button>
        <button class="config-tab" onclick="showConfig('vercel')">Vercel</button>
        <button class="config-tab" onclick="showConfig('netlify')">Netlify</button>
      </div>

      <div id="config-nginx" class="config-content">
        <div class="config-block"><pre>${this.escapeHtml(this.report.serverConfigs.nginx)}</pre></div>
      </div>
      <div id="config-apache" class="config-content" style="display: none;">
        <div class="config-block"><pre>${this.escapeHtml(this.report.serverConfigs.apache)}</pre></div>
      </div>
      <div id="config-vercel" class="config-content" style="display: none;">
        <div class="config-block"><pre>${this.escapeHtml(this.report.serverConfigs.vercel)}</pre></div>
      </div>
      <div id="config-netlify" class="config-content" style="display: none;">
        <div class="config-block"><pre>${this.escapeHtml(this.report.serverConfigs.netlify)}</pre></div>
      </div>
    </div>
  </div>

  <script>
    // Compression chart
    const ctx = document.getElementById('compressionChart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(algorithms.map(a => a.toUpperCase()))},
        datasets: [{
          label: 'Total Size',
          data: ${JSON.stringify(algorithms.map(a => totals.get(a) || 0))},
          backgroundColor: ${JSON.stringify(algorithms.map(a => colors[a as keyof typeof colors]))},
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: 'Compression Algorithm Comparison',
            color: '#fff'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: '#888',
              callback: function(value) {
                return (value / 1024 / 1024).toFixed(1) + ' MB';
              }
            },
            grid: { color: 'rgba(255,255,255,0.1)' }
          },
          x: {
            ticks: { color: '#fff' },
            grid: { display: false }
          }
        }
      }
    });

    // Tab switching
    function showConfig(type) {
      document.querySelectorAll('.config-content').forEach(el => el.style.display = 'none');
      document.getElementById('config-' + type).style.display = 'block';
      document.querySelectorAll('.config-tab').forEach(el => el.classList.remove('active'));
      event.target.classList.add('active');
    }
  </script>
</body>
</html>`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
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
  
  const benchmark = new CompressionBenchmark();
  
  try {
    const report = await benchmark.benchmark();
    benchmark.generateReport(outputPath);
    
    console.log('\n📊 Summary:');
    console.log(`   Files Benchmarked: ${report.files.length}`);
    console.log(`   Total Original Size: ${(report.summary.totalOriginalSize / 1024 / 1024).toFixed(2)} MB`);
    
    for (const [speed, time] of report.summary.estimatedLoadTimes) {
      console.log(`   Load Time (${speed}): ${time.toFixed(2)}s`);
    }
    
    console.log(`   Annual Bandwidth Savings: ${(report.summary.annualBandwidthSavings / 1024 / 1024 / 1024).toFixed(2)} GB`);
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  }
}

main();
