#!/usr/bin/env tsx
/**
 * Performance Budget Checker for candy_world
 * 
 * Validates bundle sizes against defined budgets
 * Fails builds if budgets are exceeded
 * 
 * Usage: tsx performance-budget.ts [--check] [--output ./stats/budget-report.json]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const STATS_DIR = path.join(__dirname, '../stats');
const OUTPUT_FILE = path.join(STATS_DIR, 'budget-report.json');

// Performance budgets configuration
interface BudgetConfig {
  budgets: {
    main: string;
    vendor: string;
    wasm: string;
    total: string;
  };
  thresholds: {
    warning: number; // percentage of budget
    error: number;   // percentage of budget
  };
}

interface ChunkBudget {
  name: string;
  budget: number;
  actual: number;
  status: 'pass' | 'warning' | 'error';
  percentage: number;
}

interface BudgetReport {
  timestamp: string;
  config: BudgetConfig;
  results: ChunkBudget[];
  overall: {
    status: 'pass' | 'warning' | 'error';
    totalSize: number;
    totalBudget: number;
  };
  recommendations: string[];
}

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

class PerformanceBudgetChecker {
  private config: BudgetConfig;
  private report: BudgetReport;

  constructor(config: BudgetConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.report = {
      timestamp: new Date().toISOString(),
      config,
      results: [],
      overall: {
        status: 'pass',
        totalSize: 0,
        totalBudget: 0
      },
      recommendations: []
    };
  }

  async check(): Promise<BudgetReport> {
    console.log('💰 Checking performance budgets...');
    console.log('');
    console.log('Budgets:');
    console.log(`  Main:   ${this.config.budgets.main}`);
    console.log(`  Vendor: ${this.config.budgets.vendor}`);
    console.log(`  WASM:   ${this.config.budgets.wasm}`);
    console.log(`  Total:  ${this.config.budgets.total}`);
    console.log('');

    // Scan dist directory
    const chunks = await this.scanChunks();
    
    // Check each budget
    for (const [name, budgetStr] of Object.entries(this.config.budgets)) {
      const budget = this.parseSize(budgetStr);
      let actual = 0;

      if (name === 'total') {
        actual = chunks.reduce((sum, c) => sum + c.size, 0);
      } else {
        const chunk = chunks.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
        actual = chunk?.size || 0;
      }

      const percentage = actual / budget;
      let status: 'pass' | 'warning' | 'error' = 'pass';

      if (percentage >= this.config.thresholds.error) {
        status = 'error';
      } else if (percentage >= this.config.thresholds.warning) {
        status = 'warning';
      }

      this.report.results.push({
        name,
        budget,
        actual,
        status,
        percentage
      });

      // Update overall status (worst wins)
      if (status === 'error' || (status === 'warning' && this.report.overall.status === 'pass')) {
        this.report.overall.status = status;
      }

      this.report.overall.totalSize += actual;
      this.report.overall.totalBudget += budget;
    }

    // Generate recommendations
    this.generateRecommendations();

    return this.report;
  }

  private async scanChunks(): Promise<Array<{ name: string; size: number }>> {
    const chunks: Array<{ name: string; size: number }> = [];

    if (!fs.existsSync(DIST_DIR)) {
      console.log('⚠️  No dist directory found. Run build first.');
      return chunks;
    }

    const entries = fs.readdirSync(DIST_DIR, { recursive: true }) as string[];

    for (const entry of entries) {
      const fullPath = path.join(DIST_DIR, entry);
      
      if (fs.statSync(fullPath).isFile()) {
        const size = fs.statSync(fullPath).size;
        const name = path.basename(entry);
        
        // Group by type
        if (name.endsWith('.js') || name.endsWith('.ts')) {
          if (name.includes('vendor') || name.includes('node_modules')) {
            chunks.push({ name: 'vendor', size });
          } else if (name.includes('main') || name.includes('index')) {
            chunks.push({ name: 'main', size });
          } else {
            chunks.push({ name: name.replace(/\.[jt]s$/, ''), size });
          }
        } else if (name.endsWith('.wasm')) {
          chunks.push({ name: 'wasm', size });
        }
      }
    }

    // Aggregate by name
    const aggregated = new Map<string, number>();
    for (const chunk of chunks) {
      const current = aggregated.get(chunk.name) || 0;
      aggregated.set(chunk.name, current + chunk.size);
    }

    return Array.from(aggregated.entries()).map(([name, size]) => ({ name, size }));
  }

  private parseSize(sizeStr: string): number {
    const match = sizeStr.match(/^([\d.]+)\s*(b|kb|mb|gb)?$/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = (match[2] || 'b').toLowerCase();

    const multipliers: Record<string, number> = {
      b: 1,
      kb: 1024,
      mb: 1024 * 1024,
      gb: 1024 * 1024 * 1024
    };

    return value * (multipliers[unit] || 1);
  }

  private generateRecommendations(): void {
    for (const result of this.report.results) {
      if (result.status === 'error') {
        if (result.name === 'vendor') {
          this.report.recommendations.push(
            `VENDOR BUDGET EXCEEDED: Consider using dynamic imports for Three.js or switching to a lighter alternative.`
          );
        } else if (result.name === 'main') {
          this.report.recommendations.push(
            `MAIN BUDGET EXCEEDED: Split main.ts into smaller chunks or defer non-critical initialization.`
          );
        } else if (result.name === 'wasm') {
          this.report.recommendations.push(
            `WASM BUDGET EXCEEDED: Run wasm-opt with -O3 to strip debug symbols and optimize.`
          );
        } else if (result.name === 'total') {
          this.report.recommendations.push(
            `TOTAL BUDGET EXCEEDED: Implement code splitting and lazy loading for non-critical features.`
          );
        }
      } else if (result.status === 'warning') {
        this.report.recommendations.push(
          `${result.name.toUpperCase()} approaching budget (${(result.percentage * 100).toFixed(0)}%). Monitor closely.`
        );
      }
    }
  }

  printReport(): void {
    console.log('');
    console.log('📊 Budget Report');
    console.log('═'.repeat(60));
    
    for (const result of this.report.results) {
      const icon = result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️ ' : '❌';
      const color = result.status === 'pass' ? '\x1b[32m' : result.status === 'warning' ? '\x1b[33m' : '\x1b[31m';
      const reset = '\x1b[0m';
      
      console.log(`${icon} ${color}${result.name.toUpperCase().padEnd(8)}${reset} ${this.formatBytes(result.actual).padStart(10)} / ${this.formatBytes(result.budget).padStart(10)} (${(result.percentage * 100).toFixed(1)}%)`);
    }

    console.log('═'.repeat(60));
    console.log(`Overall: ${this.report.overall.status.toUpperCase()}`);
    console.log(`Total: ${this.formatBytes(this.report.overall.totalSize)} / ${this.formatBytes(this.report.overall.totalBudget)}`);
    console.log('');

    if (this.report.recommendations.length > 0) {
      console.log('💡 Recommendations:');
      for (const rec of this.report.recommendations) {
        console.log(`  • ${rec}`);
      }
      console.log('');
    }
  }

  saveReport(outputPath: string = OUTPUT_FILE): void {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(this.report, null, 2));
    console.log(`💾 Report saved: ${outputPath}`);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  shouldFail(): boolean {
    return this.report.overall.status === 'error';
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : OUTPUT_FILE;

  const checker = new PerformanceBudgetChecker();
  
  try {
    await checker.check();
    checker.printReport();
    checker.saveReport(outputPath);

    if (checkOnly && checker.shouldFail()) {
      console.error('❌ Performance budget check failed!');
      process.exit(1);
    }

    if (checker.shouldFail()) {
      console.warn('⚠️  Performance budgets exceeded. See report for details.');
    } else {
      console.log('✅ All performance budgets met!');
    }
  } catch (error) {
    console.error('❌ Budget check failed:', error);
    process.exit(1);
  }
}

main();
