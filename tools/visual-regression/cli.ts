#!/usr/bin/env node
import { ScreenshotCapture, VIEWPOINTS, QUALITY_SETTINGS, VIEWPORTS } from './src/screenshot-capture.js';
import { ScreenshotComparator } from './src/screenshot-compare.js';
import { BaselineManager } from './src/baseline-manager.js';
import { ReportGenerator } from './src/report-generator.js';
import { PerformanceScreenshotCapture } from './src/performance-screenshot.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Test Configuration
 */
interface TestConfig {
  baseUrl: string;
  outputDir: string;
  baselineDir: string;
  viewpoints: string[];
  qualities: string[];
  viewports: string[];
  threshold: number;
  updateBaselines: boolean;
  generateReport: boolean;
  capturePerformance: boolean;
  skipComparison: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: TestConfig = {
  baseUrl: process.env.CANDY_WORLD_URL || 'http://localhost:5173',
  outputDir: './test/screenshots',
  baselineDir: './test/baselines',
  viewpoints: VIEWPOINTS.map(v => v.name),
  qualities: ['medium', 'high'],
  viewports: ['desktop'],
  threshold: 0.05,
  updateBaselines: false,
  generateReport: true,
  capturePerformance: false,
  skipComparison: false
};

/**
 * Load configuration from file
 */
function loadConfig(configPath?: string): TestConfig {
  if (configPath && fs.existsSync(configPath)) {
    const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return { ...DEFAULT_CONFIG, ...userConfig };
  }
  
  // Try to load from default locations
  const defaultPaths = [
    './visual-regression.config.json',
    './.vr.config.json',
    './tools/visual-regression/config.json'
  ];
  
  for (const p of defaultPaths) {
    if (fs.existsSync(p)) {
      const userConfig = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return { ...DEFAULT_CONFIG, ...userConfig };
    }
  }
  
  return DEFAULT_CONFIG;
}

/**
 * Visual Regression Test Runner
 */
async function runVisualTests(config: TestConfig): Promise<void> {
  const startTime = Date.now();
  
  console.log('🎮 Candy World Visual Regression Testing');
  console.log('========================================\n');
  
  // Initialize baseline manager
  const baselineManager = new BaselineManager({
    baselineDir: config.baselineDir,
    branchIsolation: true,
    useGitLFS: true
  });
  
  await baselineManager.init();
  
  // Ensure output directories exist
  fs.mkdirSync(config.outputDir, { recursive: true });
  
  // Filter viewpoints, qualities, and viewports
  const viewpoints = VIEWPOINTS.filter(v => config.viewpoints.includes(v.name));
  const qualities = config.qualities.map(q => QUALITY_SETTINGS[q as keyof typeof QUALITY_SETTINGS]).filter(Boolean);
  const viewports = VIEWPORTS.filter(v => config.viewports.includes(v.name));
  
  console.log(`📸 Configuration:`);
  console.log(`   URL: ${config.baseUrl}`);
  console.log(`   Viewpoints: ${viewpoints.map(v => v.name).join(', ')}`);
  console.log(`   Qualities: ${qualities.map(q => q.name).join(', ')}`);
  console.log(`   Viewports: ${viewports.map(v => v.name).join(', ')}`);
  console.log(`   Threshold: ${(config.threshold * 100).toFixed(1)}%`);
  console.log(`   Update baselines: ${config.updateBaselines ? 'Yes' : 'No'}`);
  console.log('');
  
  const totalTests = viewpoints.length * qualities.length * viewports.length;
  let completed = 0;
  let passed = 0;
  let failed = 0;
  const results: any[] = [];
  const capturedScreenshots: string[] = [];
  
  // Capture phase
  console.log(`📸 Capturing ${totalTests} screenshots...\n`);
  
  for (const viewpoint of viewpoints) {
    for (const quality of qualities) {
      for (const viewport of viewports) {
        const testName = `${viewpoint.name}-${quality.name}-${viewport.name}`;
        const capture = new ScreenshotCapture(config.baseUrl);
        
        try {
          await capture.init(viewport);
          
          const screenshotOptions = {
            viewpoint,
            quality,
            viewport,
            outputDir: path.join(config.outputDir, viewpoint.name)
          };
          
          await capture.navigate(screenshotOptions);
          const screenshotPath = await capture.capture(screenshotOptions);
          capturedScreenshots.push(screenshotPath);
          
          // Update baseline if requested
          if (config.updateBaselines) {
            await baselineManager.addBaseline(screenshotPath, {
              viewpoint: viewpoint.name,
              quality: quality.name,
              viewport: viewport.name
            });
          }
          
          completed++;
          process.stdout.write(`\r   [${completed}/${totalTests}] ${testName.padEnd(40)} ✓`);
        } catch (error) {
          console.error(`\n   ❌ Failed: ${testName}`, error);
          failed++;
        } finally {
          await capture.close();
        }
      }
    }
  }
  
  console.log('\n');
  
  // Comparison phase
  if (!config.skipComparison && !config.updateBaselines) {
    console.log('🔍 Comparing screenshots against baselines...\n');
    
    const comparator = new ScreenshotComparator();
    
    for (const screenshotPath of capturedScreenshots) {
      const filename = path.basename(screenshotPath, '.png');
      const match = filename.match(/^(\w+)-(low|medium|high|ultra)-(mobile|desktop|ultrawide|tablet)/);
      
      if (!match) continue;
      
      const [, vp, quality, viewport] = match;
      const baseline = await baselineManager.getBaseline(vp, quality, viewport);
      
      if (!baseline) {
        console.log(`   ⚠️  No baseline found for: ${filename}`);
        continue;
      }
      
      try {
        const result = await comparator.compare(
          baseline.path,
          screenshotPath,
          path.join(config.outputDir, 'diffs', vp),
          { threshold: config.threshold, includeAA: false }
        );
        
        results.push(result);
        
        if (result.passed) {
          passed++;
          process.stdout.write(`   ✓ ${filename} (${result.diffPercentage.toFixed(2)}%)\n`);
        } else {
          failed++;
          process.stdout.write(`   ✗ ${filename} (${result.diffPercentage.toFixed(2)}%)${result.diffPath ? ' [diff generated]' : ''}\n`);
        }
      } catch (error) {
        console.error(`   ❌ Comparison failed: ${filename}`, error);
        failed++;
      }
    }
    
    console.log('');
  }
  
  // Performance capture
  if (config.capturePerformance) {
    console.log('📊 Capturing performance profiles...\n');
    
    const perfResults = await PerformanceScreenshotCapture.runFullSuite(
      path.join(config.outputDir, 'performance'),
      config.baseUrl,
      viewpoints.map(v => ({
        name: v.name,
        cameraPosition: v.cameraPosition,
        cameraTarget: v.cameraTarget
      }))
    );
    
    console.log(`   Captured ${perfResults.length} performance profiles\n`);
  }
  
  // Generate report
  if (config.generateReport &⚡ !config.updateBaselines) {
    console.log('📄 Generating report...\n');
    
    const stats = new ScreenshotComparator().getSummaryStats(results);
    
    const reportData = {
      timestamp: new Date().toISOString(),
      branch: baselineManager['getCurrentBranch'](),
      commit: baselineManager['getCurrentCommit'](),
      results,
      stats,
      duration: Date.now() - startTime
    };
    
    const reportGenerator = new ReportGenerator({
      title: 'Candy World Visual Regression Report',
      outputDir: path.join(config.outputDir, 'report'),
      includeDiffSlider: true,
      enablePDFExport: true
    });
    
    const reportPath = await reportGenerator.generate(reportData);
    console.log(`   Report: ${reportPath}\n`);
  }
  
  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('========================================');
  console.log('📊 Summary');
  console.log('========================================');
  console.log(`   Duration: ${duration}s`);
  
  if (!config.skipComparison &⚡ !config.updateBaselines) {
    console.log(`   Passed: ${passed}/${results.length}`);
    console.log(`   Failed: ${failed}/${results.length}`);
    console.log(`   Pass rate: ${((passed / results.length) * 100).toFixed(1)}%`);
  }
  
  console.log(`   Screenshots: ${capturedScreenshots.length}`);
  
  if (config.updateBaselines) {
    console.log('\n✅ Baselines updated successfully');
  } else if (failed > 0) {
    console.log('\n❌ Some tests failed. Review the report for details.');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
  }
}

/**
 * CLI Help
 */
function showHelp(): void {
  console.log(`
🎮 Candy World Visual Regression Testing CLI

Usage: npm run test:visual [options]

Options:
  --config, -c <path>       Config file path
  --url, -u <url>           Base URL (default: http://localhost:5173)
  --viewpoints, -v <list>   Comma-separated viewpoints (spawn,lake,forest,night,particles,weather)
  --qualities, -q <list>    Comma-separated qualities (low,medium,high,ultra)
  --viewports, -p <list>    Comma-separated viewports (mobile,desktop,ultrawide,tablet)
  --threshold, -t <float>   Diff threshold (default: 0.05)
  --update, -U              Update baselines
  --no-report               Skip report generation
  --performance, -perf      Capture performance profiles
  --help, -h                Show this help

Examples:
  npm run test:visual
  npm run test:visual -- --viewpoints spawn,lake --qualities high
  npm run test:visual -- --update
  npm run test:visual -- --performance
`);
}

/**
 * Parse CLI arguments
 */
function parseArgs(): Partial<TestConfig> & { help?: boolean } {
  const args = process.argv.slice(2);
  const options: any = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--config':
      case '-c':
        options.config = args[++i];
        break;
      case '--url':
      case '-u':
        options.baseUrl = args[++i];
        break;
      case '--viewpoints':
      case '-v':
        options.viewpoints = args[++i].split(',');
        break;
      case '--qualities':
      case '-q':
        options.qualities = args[++i].split(',');
        break;
      case '--viewports':
      case '-p':
        options.viewports = args[++i].split(',');
        break;
      case '--threshold':
      case '-t':
        options.threshold = parseFloat(args[++i]);
        break;
      case '--update':
      case '-U':
        options.updateBaselines = true;
        break;
      case '--no-report':
        options.generateReport = false;
        break;
      case '--performance':
      case '-perf':
        options.capturePerformance = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }
  
  return options;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const cliOptions = parseArgs();
  
  if (cliOptions.help) {
    showHelp();
    process.exit(0);
  }
  
  // Load config
  const configPath = cliOptions.config;
  const baseConfig = loadConfig(configPath);
  
  // Merge CLI options
  const config: TestConfig = {
    ...baseConfig,
    ...cliOptions
  };
  
  try {
    await runVisualTests(config);
  } catch (error) {
    console.error('\n❌ Test run failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runVisualTests, loadConfig, DEFAULT_CONFIG };
