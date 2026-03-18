import * as fs from 'fs';
import * as path from 'path';
import type { ComparisonResult } from './screenshot-compare.js';

/**
 * Report Configuration
 */
export interface ReportConfig {
  title: string;
  outputDir: string;
  includeSideBySide?: boolean;
  includeDiffSlider?: boolean;
  enablePDFExport?: boolean;
  customCSS?: string;
  customHeader?: string;
  customFooter?: string;
}

/**
 * Report Data
 */
export interface ReportData {
  timestamp: string;
  branch: string;
  commit: string;
  results: ComparisonResult[];
  stats: {
    total: number;
    passed: number;
    failed: number;
    averageDiff: number;
    maxDiff: number;
    failedTests: string[];
  };
  duration: number; // ms
}

/**
 * HTML Report Generator
 * 
 * Generates interactive HTML reports with:
 * - Side-by-side before/after comparisons
 * - Slider to reveal differences
 * - Summary statistics
 * - PDF export capability
 */
export class ReportGenerator {
  private config: Required<ReportConfig>;

  constructor(config: ReportConfig) {
    this.config = {
      includeSideBySide: true,
      includeDiffSlider: true,
      enablePDFExport: true,
      customCSS: '',
      customHeader: '',
      customFooter: '',
      ...config
    };
  }

  /**
   * Generate HTML report
   */
  async generate(data: ReportData): Promise<string> {
    fs.mkdirSync(this.config.outputDir, { recursive: true });

    const reportPath = path.join(this.config.outputDir, 'index.html');
    const html = this.buildHTML(data);
    
    fs.writeFileSync(reportPath, html);

    // Copy assets
    await this.copyAssets();

    console.log(`✅ Report generated: ${reportPath}`);
    return reportPath;
  }

  /**
   * Build HTML content
   */
  private buildHTML(data: ReportData): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.config.title}</title>
    <style>${this.getCSS()}</style>
    ${this.config.customCSS ? `<style>${this.config.customCSS}</style>` : ''}
</head>
<body>
    ${this.buildHeader(data)}
    ${this.buildSummary(data)}
    ${this.buildResults(data)}
    ${this.buildFooter(data)}
    <script>${this.getJavaScript()}</script>
</body>
</html>`;
  }

  /**
   * Build report header
   */
  private buildHeader(data: ReportData): string {
    const header = this.config.customHeader || `
      <div class="header">
        <h1>🎮 ${this.config.title}</h1>
        <div class="meta">
          <span>📅 ${new Date(data.timestamp).toLocaleString()}</span>
          <span>🌿 ${data.branch}</span>
          <span>🔀 ${data.commit.substring(0, 8)}</span>
          <span>⏱️ ${(data.duration / 1000).toFixed(2)}s</span>
        </div>
      </div>
    `;
    return header;
  }

  /**
   * Build summary section
   */
  private buildSummary(data: ReportData): string {
    const { stats } = data;
    const passRate = ((stats.passed / stats.total) * 100).toFixed(1);
    
    return `
      <div class="summary">
        <h2>📊 Summary</h2>
        <div class="stats-grid">
          <div class="stat ${stats.failed === 0 ? 'pass' : 'fail'}">
            <div class="stat-value">${stats.passed}/${stats.total}</div>
            <div class="stat-label">Tests Passed</div>
            <div class="stat-sublabel">${passRate}% pass rate</div>
          </div>
          <div class="stat">
            <div class="stat-value">${stats.averageDiff.toFixed(2)}%</div>
            <div class="stat-label">Average Diff</div>
          </div>
          <div class="stat">
            <div class="stat-value">${stats.maxDiff.toFixed(2)}%</div>
            <div class="stat-label">Max Diff</div>
          </div>
          <div class="stat">
            <div class="stat-value">${stats.failed}</div>
            <div class="stat-label">Failed</div>
          </div>
        </div>
        
        <div class="progress-bar">
          <div class="progress-pass" style="width: ${passRate}%"></div>
          <div class="progress-fail" style="width: ${((stats.failed / stats.total) * 100).toFixed(1)}%"></div>
        </div>
        
        ${stats.failed > 0 ? `
        <div class="failed-tests">
          <h3>❌ Failed Tests</h3>
          <ul>
            ${stats.failedTests.map(t => `<li>${t}</li>`).join('')}
          </ul>
        </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Build results section
   */
  private buildResults(data: ReportData): string {
    return `
      <div class="results">
        <h2>🔍 Detailed Results</h2>
        <div class="results-grid">
          ${data.results.map((result, index) => this.buildResultCard(result, index)).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Build individual result card
   */
  private buildResultCard(result: ComparisonResult, index: number): string {
    const name = path.basename(result.currentPath, '.png');
    const status = result.passed ? 'pass' : 'fail';
    const statusIcon = result.passed ? '✅' : '❌';
    
    // Copy images to report directory
    const baselineRel = this.copyImageToReport(result.baselinePath, 'baseline');
    const currentRel = this.copyImageToReport(result.currentPath, 'current');
    const diffRel = result.diffPath ? this.copyImageToReport(result.diffPath, 'diff') : null;

    return `
      <div class="result-card ${status}" data-index="${index}">
        <div class="result-header">
          <span class="status-icon">${statusIcon}</span>
          <span class="result-name">${name}</span>
          <span class="result-diff ${result.diffPercentage > 5 ? 'high' : result.diffPercentage > 1 ? 'medium' : 'low'}">
            ${result.diffPercentage.toFixed(2)}%
          </span>
        </div>
        
        ${this.config.includeDiffSlider && diffRel ? `
        <div class="comparison-slider">
          <div class="slider-container" data-index="${index}">
            <img src="${baselineRel}" class="img-baseline" alt="Baseline">
            <div class="slider-overlay">
              <img src="${currentRel}" class="img-current" alt="Current">
            </div>
            <div class="slider-handle">
              <div class="slider-button">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                  <path d="M8 5v14l-11-7z" transform="translate(24,0)"/>
                </svg>
              </div>
            </div>
          </div>
        </div>
        ` : `
        <div class="comparison-side-by-side">
          <div class="img-container">
            <label>Baseline</label>
            <img src="${baselineRel}" alt="Baseline">
          </div>
          <div class="img-container">
            <label>Current</label>
            <img src="${currentRel}" alt="Current">
          </div>
        </div>
        `}
        
        ${diffRel ? `
        <div class="diff-view">
          <label>Diff (changes highlighted)</label>
          <img src="${diffRel}" alt="Diff">
        </div>
        ` : ''}
        
        <div class="result-details">
          <div class="detail-row">
            <span class="detail-label">Diff Pixels:</span>
            <span class="detail-value">${result.diffPixels.toLocaleString()} / ${result.totalPixels.toLocaleString()}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Threshold:</span>
            <span class="detail-value">${(result.threshold * 100).toFixed(1)}%</span>
          </div>
          ${result.perceptualDiff ? `
          <div class="detail-row">
            <span class="detail-label">Perceptual Diff:</span>
            <span class="detail-value">${result.perceptualDiff.diffPercentage.toFixed(2)}%</span>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Copy image to report directory and return relative path
   */
  private copyImageToReport(imagePath: string, type: string): string {
    if (!fs.existsSync(imagePath)) {
      return '';
    }

    const filename = `${type}-${path.basename(imagePath)}`;
    const destPath = path.join(this.config.outputDir, 'images', filename);
    
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    
    // Copy if not already there
    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(imagePath, destPath);
    }
    
    return `images/${filename}`;
  }

  /**
   * Build report footer
   */
  private buildFooter(data: ReportData): string {
    const pdfButton = this.config.enablePDFExport ? `
      <button class="btn btn-pdf" onclick="exportPDF()">
        📄 Export PDF
      </button>
    ` : '';

    return this.config.customFooter || `
      <div class="footer">
        ${pdfButton}
        <button class="btn btn-collapse" onclick="toggleAll(false)">
          📕 Collapse All
        </button>
        <button class="btn btn-expand" onclick="toggleAll(true)">
          📖 Expand All
        </button>
      </div>
    `;
  }

  /**
   * Get CSS styles
   */
  private getCSS(): string {
    return `
      :root {
        --color-bg: #1a1a2e;
        --color-surface: #16213e;
        --color-surface-light: #1f2b4d;
        --color-text: #eaeaea;
        --color-text-muted: #a0a0a0;
        --color-pass: #4ade80;
        --color-pass-bg: rgba(74, 222, 128, 0.1);
        --color-fail: #f87171;
        --color-fail-bg: rgba(248, 113, 113, 0.1);
        --color-accent: #e94560;
        --border-radius: 12px;
      }
      
      * { box-sizing: border-box; margin: 0; padding: 0; }
      
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--color-bg);
        color: var(--color-text);
        line-height: 1.6;
        padding: 20px;
      }
      
      .header {
        text-align: center;
        padding: 30px 20px;
        background: var(--color-surface);
        border-radius: var(--border-radius);
        margin-bottom: 20px;
      }
      
      .header h1 {
        font-size: 2rem;
        margin-bottom: 15px;
        background: linear-gradient(135deg, #e94560, #ff6b6b);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      
      .meta {
        display: flex;
        justify-content: center;
        gap: 20px;
        flex-wrap: wrap;
        color: var(--color-text-muted);
        font-size: 0.9rem;
      }
      
      .summary {
        background: var(--color-surface);
        border-radius: var(--border-radius);
        padding: 25px;
        margin-bottom: 20px;
      }
      
      .summary h2 {
        margin-bottom: 20px;
        font-size: 1.3rem;
      }
      
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 15px;
        margin-bottom: 20px;
      }
      
      .stat {
        background: var(--color-surface-light);
        padding: 20px;
        border-radius: 8px;
        text-align: center;
      }
      
      .stat.pass { border: 2px solid var(--color-pass); }
      .stat.fail { border: 2px solid var(--color-fail); }
      
      .stat-value {
        font-size: 2rem;
        font-weight: bold;
        color: var(--color-text);
      }
      
      .stat-label {
        font-size: 0.9rem;
        color: var(--color-text-muted);
        margin-top: 5px;
      }
      
      .stat-sublabel {
        font-size: 0.8rem;
        color: var(--color-text-muted);
        margin-top: 3px;
      }
      
      .progress-bar {
        height: 8px;
        background: var(--color-fail-bg);
        border-radius: 4px;
        overflow: hidden;
        display: flex;
        margin-bottom: 20px;
      }
      
      .progress-pass {
        background: var(--color-pass);
        transition: width 0.5s ease;
      }
      
      .progress-fail {
        background: var(--color-fail);
        transition: width 0.5s ease;
      }
      
      .failed-tests {
        background: var(--color-fail-bg);
        border-radius: 8px;
        padding: 15px;
      }
      
      .failed-tests h3 {
        margin-bottom: 10px;
      }
      
      .failed-tests ul {
        list-style: none;
      }
      
      .failed-tests li {
        padding: 5px 0;
        border-bottom: 1px solid rgba(248, 113, 113, 0.2);
      }
      
      .results h2 {
        margin-bottom: 20px;
      }
      
      .results-grid {
        display: grid;
        gap: 20px;
      }
      
      .result-card {
        background: var(--color-surface);
        border-radius: var(--border-radius);
        overflow: hidden;
        border: 2px solid transparent;
      }
      
      .result-card.pass { border-color: var(--color-pass); }
      .result-card.fail { border-color: var(--color-fail); }
      
      .result-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 15px 20px;
        background: var(--color-surface-light);
        cursor: pointer;
      }
      
      .status-icon { font-size: 1.2rem; }
      .result-name { flex: 1; font-weight: 600; }
      
      .result-diff {
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.85rem;
        font-weight: 600;
      }
      
      .result-diff.low { background: var(--color-pass-bg); color: var(--color-pass); }
      .result-diff.medium { background: rgba(250, 204, 21, 0.2); color: #facc15; }
      .result-diff.high { background: var(--color-fail-bg); color: var(--color-fail); }
      
      /* Comparison Slider */
      .slider-container {
        position: relative;
        overflow: hidden;
        user-select: none;
      }
      
      .slider-container img {
        width: 100%;
        display: block;
      }
      
      .slider-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 50%;
        height: 100%;
        overflow: hidden;
        border-right: 2px solid var(--color-accent);
      }
      
      .slider-handle {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 50%;
        width: 40px;
        transform: translateX(-50%);
        cursor: ew-resize;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .slider-button {
        width: 40px;
        height: 40px;
        background: var(--color-accent);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      }
      
      .slider-button svg {
        width: 20px;
        height: 20px;
        color: white;
      }
      
      /* Side by Side */
      .comparison-side-by-side {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        padding: 15px;
      }
      
      .img-container label {
        display: block;
        padding: 8px;
        background: var(--color-surface-light);
        font-size: 0.85rem;
        text-align: center;
      }
      
      .img-container img, .diff-view img {
        width: 100%;
        display: block;
      }
      
      .diff-view {
        padding: 0 15px 15px;
      }
      
      .diff-view label {
        display: block;
        padding: 8px;
        background: var(--color-surface-light);
        font-size: 0.85rem;
        margin-bottom: 10px;
      }
      
      .result-details {
        padding: 15px 20px;
        background: var(--color-surface-light);
        font-size: 0.9rem;
      }
      
      .detail-row {
        display: flex;
        justify-content: space-between;
        padding: 5px 0;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      
      .detail-row:last-child { border-bottom: none; }
      
      .detail-label { color: var(--color-text-muted); }
      
      .footer {
        display: flex;
        gap: 10px;
        justify-content: center;
        padding: 30px;
      }
      
      .btn {
        padding: 12px 24px;
        border: none;
        border-radius: 8px;
        font-size: 0.95rem;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .btn:hover { transform: translateY(-2px); }
      
      .btn-pdf { background: var(--color-accent); color: white; }
      .btn-collapse { background: var(--color-surface-light); color: var(--color-text); }
      .btn-expand { background: var(--color-surface-light); color: var(--color-text); }
      
      @media print {
        .footer, .slider-handle { display: none; }
        .result-card { break-inside: avoid; }
      }
      
      @media (max-width: 768px) {
        .stats-grid { grid-template-columns: repeat(2, 1fr); }
        .comparison-side-by-side { grid-template-columns: 1fr; }
        .meta { flex-direction: column; gap: 5px; }
      }
    `;
  }

  /**
   * Get JavaScript for interactivity
   */
  private getJavaScript(): string {
    return `
      // Slider functionality
      document.querySelectorAll('.slider-container').forEach(container => {
        const overlay = container.querySelector('.slider-overlay');
        const handle = container.querySelector('.slider-handle');
        let isDragging = false;
        
        function updateSlider(clientX) {
          const rect = container.getBoundingClientRect();
          const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
          const percent = (x / rect.width) * 100;
          overlay.style.width = percent + '%';
          handle.style.left = percent + '%';
        }
        
        handle.addEventListener('mousedown', () => isDragging = true);
        document.addEventListener('mouseup', () => isDragging = false);
        document.addEventListener('mousemove', (e) => {
          if (isDragging) updateSlider(e.clientX);
        });
        
        // Touch support
        handle.addEventListener('touchstart', () => isDragging = true);
        document.addEventListener('touchend', () => isDragging = false);
        document.addEventListener('touchmove', (e) => {
          if (isDragging) updateSlider(e.touches[0].clientX);
        });
      });
      
      // Expand/collapse
      document.querySelectorAll('.result-header').forEach(header => {
        header.addEventListener('click', () => {
          const card = header.closest('.result-card');
          card.classList.toggle('collapsed');
        });
      });
      
      function toggleAll(expand) {
        document.querySelectorAll('.result-card').forEach(card => {
          card.classList.toggle('collapsed', !expand);
        });
      }
      
      function exportPDF() {
        window.print();
      }
    `;
  }

  /**
   * Copy static assets
   */
  private async copyAssets(): Promise<void> {
    // Create images directory
    fs.mkdirSync(path.join(this.config.outputDir, 'images'), { recursive: true });
  }

  /**
   * Export report to PDF (requires puppeteer)
   */
  async exportPDF(reportPath: string, outputPath: string): Promise<void> {
    try {
      const puppeteer = await import('puppeteer');
      
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
      
      await page.goto(`file://${reportPath}`, { waitUntil: 'networkidle0' });
      await page.pdf({
        path: outputPath,
        format: 'A4',
        landscape: true,
        printBackground: true
      });
      
      await browser.close();
      
      console.log(`✅ PDF exported: ${outputPath}`);
    } catch (error) {
      console.error('❌ PDF export failed. Install puppeteer:', error);
      throw error;
    }
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const resultsPath = process.argv[2];
  const outputDir = process.argv[3] || './reports';

  if (!resultsPath) {
    console.log('Usage: tsx report-generator.ts <results-json> [output-dir]');
    process.exit(1);
  }

  const results: ReportData = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
  
  const generator = new ReportGenerator({
    title: 'Visual Regression Report',
    outputDir
  });
  
  generator.generate(results)
    .then((path) => {
      console.log(`✅ Report generated: ${path}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Report generation failed:', error);
      process.exit(1);
    });
}
