#!/usr/bin/env tsx
/**
 * Run All Optimizations for candy_world
 * 
 * Orchestrates all build optimization tools
 * Generates comprehensive final report
 * 
 * Usage: tsx run-all-optimizations.ts [--full]
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const STATS_DIR = path.join(__dirname, '../stats');
const REPORT_FILE = path.join(STATS_DIR, 'OPTIMIZATION_REPORT.md');

interface OptimizationResult {
  name: string;
  status: 'success' | 'warning' | 'error';
  duration: number;
  output: string;
  findings: string[];
}

interface FinalReport {
  timestamp: string;
  summary: {
    totalOptimizations: number;
    successful: number;
    warnings: number;
    errors: number;
    totalDuration: number;
  };
  results: OptimizationResult[];
  recommendations: {
    high: string[];
    medium: string[];
    low: string[];
  };
  loadTimeEstimates: {
    '3G': string;
    '4G': string;
    '5G': string;
  };
}

class OptimizationRunner {
  private results: OptimizationResult[] = [];
  private startTime = Date.now();

  async run(): Promise<FinalReport> {
    console.log('🚀 Running candy_world build optimizations...\n');

    const tools = [
      { name: 'Bundle Analyzer', script: 'bundle-analyzer.ts' },
      { name: 'Tree Shaking Audit', script: 'tree-shaking-audit.ts' },
      { name: 'Compression Benchmark', script: 'compression-benchmark.ts' },
      { name: 'Code Splitting Strategy', script: 'code-splitting-strategy.ts' },
      { name: 'Asset Optimizer', script: 'asset-optimizer.ts' },
      { name: 'Performance Budget', script: 'performance-budget.ts' }
    ];

    for (const tool of tools) {
      await this.runTool(tool.name, tool.script);
    }

    return this.generateFinalReport();
  }

  private async runTool(name: string, script: string): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔧 Running: ${name}`);
    console.log('='.repeat(60));

    const start = Date.now();
    const toolPath = path.join(__dirname, script);

    try {
      // Check if tsx is available
      const output = execSync(`npx tsx "${toolPath}"`, {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
        stdio: 'pipe'
      });

      const duration = Date.now() - start;
      
      this.results.push({
        name,
        status: 'success',
        duration,
        output,
        findings: this.extractFindings(output)
      });

      console.log(output);
      console.log(`✅ ${name} completed in ${(duration / 1000).toFixed(2)}s`);
    } catch (error: any) {
      const duration = Date.now() - start;
      
      this.results.push({
        name,
        status: 'error',
        duration,
        output: error.stdout || '',
        findings: [error.message]
      });

      console.error(`❌ ${name} failed:`, error.message);
    }
  }

  private extractFindings(output: string): string[] {
    const findings: string[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      // Look for findings in output
      if (line.includes('savings') || line.includes('unused') || 
          line.includes('optimize') || line.includes('⚠️') ||
          line.includes('potential') || line.includes('recommend')) {
        findings.push(line.trim());
      }
    }
    
    return findings.slice(0, 5); // Limit findings
  }

  private generateFinalReport(): FinalReport {
    const totalDuration = Date.now() - this.startTime;
    
    const successful = this.results.filter(r => r.status === 'success').length;
    const warnings = this.results.filter(r => r.status === 'warning').length;
    const errors = this.results.filter(r => r.status === 'error').length;

    // Aggregate recommendations
    const recommendations = {
      high: [] as string[],
      medium: [] as string[],
      low: [] as string[]
    };

    // Add key recommendations based on findings
    const allFindings = this.results.flatMap(r => r.findings);
    
    for (const finding of allFindings) {
      if (finding.toLowerCase().includes('high') || 
          finding.toLowerCase().includes('critical') ||
          finding.toLowerCase().includes('exceeded')) {
        recommendations.high.push(finding);
      } else if (finding.toLowerCase().includes('medium') ||
                 finding.toLowerCase().includes('warning')) {
        recommendations.medium.push(finding);
      } else {
        recommendations.low.push(finding);
      }
    }

    // Remove duplicates
    recommendations.high = [...new Set(recommendations.high)].slice(0, 10);
    recommendations.medium = [...new Set(recommendations.medium)].slice(0, 10);
    recommendations.low = [...new Set(recommendations.low)].slice(0, 10);

    // Estimate load times (rough estimates)
    const loadTimeEstimates = {
      '3G': '~8-15 seconds',
      '4G': '~2-4 seconds',
      '5G': '~0.5-1 second'
    };

    const report: FinalReport = {
      timestamp: new Date().toISOString(),
      summary: {
        totalOptimizations: this.results.length,
        successful,
        warnings,
        errors,
        totalDuration
      },
      results: this.results,
      recommendations,
      loadTimeEstimates
    };

    this.saveFinalReport(report);
    
    return report;
  }

  private saveFinalReport(report: FinalReport): void {
    // Ensure output directory exists
    if (!fs.existsSync(STATS_DIR)) {
      fs.mkdirSync(STATS_DIR, { recursive: true });
    }

    // Save JSON
    fs.writeFileSync(
      REPORT_FILE.replace('.md', '.json'),
      JSON.stringify(report, null, 2)
    );

    // Save Markdown
    const md = this.generateMarkdownReport(report);
    fs.writeFileSync(REPORT_FILE, md);

    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 Final Report');
    console.log('='.repeat(60));
    console.log(`Total Duration: ${(report.summary.totalDuration / 1000).toFixed(2)}s`);
    console.log(`Successful: ${report.summary.successful}/${report.summary.totalOptimizations}`);
    console.log(`Warnings: ${report.summary.warnings}`);
    console.log(`Errors: ${report.summary.errors}`);
    console.log('');
    console.log(`📁 Reports saved to:`);
    console.log(`   - ${REPORT_FILE}`);
    console.log(`   - ${REPORT_FILE.replace('.md', '.json')}`);
  }

  private generateMarkdownReport(report: FinalReport): string {
    let md = `# 🍭 candy_world Build Optimization Report\n\n`;
    md += `**Generated:** ${new Date(report.timestamp).toLocaleString()}\n\n`;
    
    // Summary
    md += `## 📊 Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Total Tools Run | ${report.summary.totalOptimizations} |\n`;
    md += `| Successful | ${report.summary.successful} |\n`;
    md += `| Warnings | ${report.summary.warnings} |\n`;
    md += `| Errors | ${report.summary.errors} |\n`;
    md += `| Total Duration | ${(report.summary.totalDuration / 1000).toFixed(2)}s |\n\n`;

    // Load Time Estimates
    md += `## ⏱️ Load Time Estimates\n\n`;
    md += `| Connection | Estimated Time |\n`;
    md += `|------------|----------------|\n`;
    md += `| 3G | ${report.loadTimeEstimates['3G']} |\n`;
    md += `| 4G | ${report.loadTimeEstimates['4G']} |\n`;
    md += `| 5G | ${report.loadTimeEstimates['5G']} |\n\n`;

    // Results
    md += `## 🔧 Tool Results\n\n`;
    for (const result of report.results) {
      const icon = result.status === 'success' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
      md += `### ${icon} ${result.name}\n\n`;
      md += `- **Status:** ${result.status}\n`;
      md += `- **Duration:** ${(result.duration / 1000).toFixed(2)}s\n`;
      
      if (result.findings.length > 0) {
        md += `- **Key Findings:**\n`;
        for (const finding of result.findings.slice(0, 3)) {
          md += `  - ${finding}\n`;
        }
      }
      md += '\n';
    }

    // Recommendations
    md += `## 💡 Recommendations\n\n`;
    
    if (report.recommendations.high.length > 0) {
      md += `### 🔴 High Priority\n\n`;
      for (const rec of report.recommendations.high) {
        md += `- ${rec}\n`;
      }
      md += '\n';
    }

    if (report.recommendations.medium.length > 0) {
      md += `### 🟡 Medium Priority\n\n`;
      for (const rec of report.recommendations.medium) {
        md += `- ${rec}\n`;
      }
      md += '\n';
    }

    if (report.recommendations.low.length > 0) {
      md += `### 🟢 Low Priority\n\n`;
      for (const rec of report.recommendations.low) {
        md += `- ${rec}\n`;
      }
      md += '\n';
    }

    // Next Steps
    md += `## 🚀 Next Steps\n\n`;
    md += `1. Review the detailed reports in \`tools/build-optimizer/stats/\`\n`;
    md += `2. Address high-priority recommendations first\n`;
    md += `3. Implement code splitting strategy from \`code-splitting-plan.md\`\n`;
    md += `4. Configure compression using the generated server configs\n`;
    md += `5. Run \`npm run budget\` before each release to validate budgets\n\n`;

    // File locations
    md += `## 📁 Generated Files\n\n`;
    md += `\`\`\`
stats/
├── bundle-analysis.html       # Interactive bundle visualization
├── bundle-analysis.json       # Raw bundle data
├── tree-shaking-report.md     # Dead code analysis
├── tree-shaking-report.json   # Raw tree-shaking data
├── compression-report.html    # Compression benchmark results
├── compression-report.json    # Raw compression data
├── code-splitting-plan.md     # Chunking strategy
├── code-splitting/            # Implementation templates
│   ├── vite.config.ts
│   ├── *.example.ts
│   └── preload-hints.html
├── asset-optimization-report.html
├── asset-optimization-report.json
├── optimize-assets.sh         # Asset optimization script
├── ResponsiveImage.astro      # Responsive image component
├── budget-report.json         # Performance budget check
├── OPTIMIZATION_REPORT.md     # This report
└── OPTIMIZATION_REPORT.json   # Raw report data
\`\`\`\n\n`;

    return md;
  }
}

// Main execution
async function main() {
  const runner = new OptimizationRunner();
  
  try {
    const report = await runner.run();
    
    if (report.summary.errors > 0) {
      console.warn(`\n⚠️  ${report.summary.errors} tool(s) reported errors`);
      process.exit(1);
    }
    
    console.log('\n✅ All optimizations complete!');
  } catch (error) {
    console.error('❌ Optimization run failed:', error);
    process.exit(1);
  }
}

main();
