import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/**
 * Comparison Options
 */
export interface ComparisonOptions {
  threshold?: number; // 0-1, default 0.1
  includeAA?: boolean; // Include anti-aliased pixels in diff, default false
  alpha?: number; // Blending factor for diff, default 0.1
  aaColor?: [number, number, number]; // Color for anti-aliased pixels
  diffColor?: [number, number, number]; // Color for different pixels
  diffColorAlt?: [number, number, number]; // Alternative color for dark backgrounds
}

/**
 * Comparison Result
 */
export interface ComparisonResult {
  passed: boolean;
  diffPercentage: number;
  diffPixels: number;
  totalPixels: number;
  baselinePath: string;
  currentPath: string;
  diffPath: string | null;
  threshold: number;
  perceptualDiff?: {
    passed: boolean;
    diffPercentage: number;
  };
}

/**
 * Screenshot Comparator
 */
export class ScreenshotComparator {
  private defaultOptions: Required<ComparisonOptions> = {
    threshold: 0.1,
    includeAA: false,
    alpha: 0.1,
    aaColor: [255, 255, 0], // Yellow for anti-aliased
    diffColor: [255, 0, 0], // Red for different
    diffColorAlt: [0, 255, 255] // Cyan for dark backgrounds
  };

  /**
   * Compare two screenshots
   */
  async compare(
    baselinePath: string,
    currentPath: string,
    outputDir: string,
    options: ComparisonOptions = {}
  ): Promise<ComparisonResult> {
    const opts = { ...this.defaultOptions, ...options };

    // Verify files exist
    if (!fs.existsSync(baselinePath)) {
      throw new Error(`Baseline screenshot not found: ${baselinePath}`);
    }
    if (!fs.existsSync(currentPath)) {
      throw new Error(`Current screenshot not found: ${currentPath}`);
    }

    // Read and parse PNGs
    const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
    const current = PNG.sync.read(fs.readFileSync(currentPath));

    // Check dimensions
    if (baseline.width !== current.width || baseline.height !== current.height) {
      throw new Error(
        `Dimension mismatch: baseline ${baseline.width}x${baseline.height} vs current ${current.width}x${current.height}`
      );
    }

    // Create diff image
    const diff = new PNG({ width: baseline.width, height: baseline.height });

    // Run pixelmatch
    const diffPixels = pixelmatch(
      baseline.data,
      current.data,
      diff.data,
      baseline.width,
      baseline.height,
      {
        threshold: opts.threshold,
        includeAA: opts.includeAA,
        alpha: opts.alpha,
        aaColor: opts.aaColor,
        diffColor: opts.diffColor,
        diffColorAlt: opts.diffColorAlt
      }
    );

    const totalPixels = baseline.width * baseline.height;
    const diffPercentage = (diffPixels / totalPixels) * 100;
    const passed = diffPercentage <= opts.threshold * 100;

    // Save diff image if there are differences
    let diffPath: string | null = null;
    if (diffPixels > 0) {
      fs.mkdirSync(outputDir, { recursive: true });
      diffPath = path.join(
        outputDir,
        `diff-${path.basename(currentPath, '.png')}.png`
      );
      fs.writeFileSync(diffPath, PNG.sync.write(diff));
    }

    // Run perceptual diff (ignores anti-aliasing)
    const perceptualDiff = this.runPerceptualDiff(baseline, current, opts);

    return {
      passed: passed && perceptualDiff.passed,
      diffPercentage,
      diffPixels,
      totalPixels,
      baselinePath,
      currentPath,
      diffPath,
      threshold: opts.threshold,
      perceptualDiff
    };
  }

  /**
   * Run perceptual diff that ignores anti-aliasing differences
   */
  private runPerceptualDiff(
    baseline: PNG,
    current: PNG,
    options: Required<ComparisonOptions>
  ): { passed: boolean; diffPercentage: number } {
    // Use a higher threshold for perceptual comparison
    const perceptualThreshold = Math.min(options.threshold * 2, 0.3);
    
    const diff = new PNG({ width: baseline.width, height: baseline.height });
    
    const diffPixels = pixelmatch(
      baseline.data,
      current.data,
      diff.data,
      baseline.width,
      baseline.height,
      {
        threshold: perceptualThreshold,
        includeAA: true, // Include AA in perceptual check but with higher threshold
        alpha: options.alpha,
        aaColor: [128, 128, 128], // Gray for AA differences
        diffColor: options.diffColor
      }
    );

    const totalPixels = baseline.width * baseline.height;
    const diffPercentage = (diffPixels / totalPixels) * 100;

    return {
      passed: diffPercentage <= perceptualThreshold * 100,
      diffPercentage
    };
  }

  /**
   * Compare multiple screenshots in batch
   */
  async compareBatch(
    comparisons: Array<{
      baseline: string;
      current: string;
      name: string;
    }>,
    outputDir: string,
    options?: ComparisonOptions
  ): Promise<ComparisonResult[]> {
    const results: ComparisonResult[] = [];

    for (const comparison of comparisons) {
      try {
        const result = await this.compare(
          comparison.baseline,
          comparison.current,
          path.join(outputDir, comparison.name),
          options
        );
        results.push(result);
      } catch (error) {
        console.error(`Failed to compare ${comparison.name}:`, error);
        throw error;
      }
    }

    return results;
  }

  /**
   * Generate side-by-side comparison image
   */
  generateSideBySide(
    baselinePath: string,
    currentPath: string,
    outputPath: string,
    options?: {
      labelBaseline?: string;
      labelCurrent?: string;
      maxWidth?: number;
    }
  ): void {
    const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
    const current = PNG.sync.read(fs.readFileSync(currentPath));

    const labelBaseline = options?.labelBaseline || 'Baseline';
    const labelCurrent = options?.labelCurrent || 'Current';

    // Calculate dimensions
    const maxWidth = options?.maxWidth || Math.max(baseline.width, current.width);
    const scale = maxWidth / Math.max(baseline.width, current.width);
    
    const scaledWidth = Math.round(baseline.width * scale);
    const scaledHeight = Math.round(baseline.height * scale);
    const labelHeight = 30;

    // Create output image (side by side with labels)
    const output = new PNG({
      width: scaledWidth * 2 + 10, // 10px gap
      height: scaledHeight + labelHeight
    });

    // Fill background
    output.data.fill(255);

    // Copy baseline (scaled)
    this.copyScaled(baseline, output, 0, labelHeight, scaledWidth, scaledHeight);
    
    // Copy current (scaled)
    this.copyScaled(current, output, scaledWidth + 10, labelHeight, scaledWidth, scaledHeight);

    // Add labels (simple implementation - would need proper text rendering for production)
    // For now, just draw colored bars
    for (let x = 0; x < scaledWidth; x++) {
      this.setPixel(output, x, 5, [0, 150, 0]); // Green for baseline
      this.setPixel(output, x, 10, [0, 150, 0]);
      this.setPixel(output, scaledWidth + 10 + x, 5, [150, 0, 0]); // Red for current
      this.setPixel(output, scaledWidth + 10 + x, 10, [150, 0, 0]);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, PNG.sync.write(output));
  }

  /**
   * Copy and scale PNG data
   */
  private copyScaled(
    source: PNG,
    dest: PNG,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void {
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const sx = Math.floor((x / dw) * source.width);
        const sy = Math.floor((y / dh) * source.height);
        const sIdx = (sy * source.width + sx) * 4;
        const dIdx = ((dy + y) * dest.width + dx + x) * 4;
        
        dest.data[dIdx] = source.data[sIdx];
        dest.data[dIdx + 1] = source.data[sIdx + 1];
        dest.data[dIdx + 2] = source.data[sIdx + 2];
        dest.data[dIdx + 3] = source.data[sIdx + 3];
      }
    }
  }

  /**
   * Set a single pixel
   */
  private setPixel(png: PNG, x: number, y: number, color: [number, number, number]): void {
    const idx = (y * png.width + x) * 4;
    png.data[idx] = color[0];
    png.data[idx + 1] = color[1];
    png.data[idx + 2] = color[2];
    png.data[idx + 3] = 255;
  }

  /**
   * Get summary statistics for batch comparison
   */
  getSummaryStats(results: ComparisonResult[]): {
    total: number;
    passed: number;
    failed: number;
    averageDiff: number;
    maxDiff: number;
    failedTests: string[];
  } {
    const passed = results.filter(r => r.passed).length;
    const failed = results.length - passed;
    const diffs = results.map(r => r.diffPercentage);
    const failedTests = results
      .filter(r => !r.passed)
      .map(r => path.basename(r.currentPath, '.png'));

    return {
      total: results.length,
      passed,
      failed,
      averageDiff: diffs.reduce((a, b) => a + b, 0) / diffs.length || 0,
      maxDiff: Math.max(...diffs, 0),
      failedTests
    };
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const baseline = process.argv[2];
  const current = process.argv[3];
  const output = process.argv[4] || './test/diffs';

  if (!baseline || !current) {
    console.log('Usage: tsx screenshot-compare.ts <baseline> <current> [output-dir]');
    process.exit(1);
  }

  const comparator = new ScreenshotComparator();
  
  comparator.compare(baseline, current, output, {
    threshold: 0.05,
    includeAA: false
  }).then((result) => {
    console.log('\n📊 Comparison Results:');
    console.log(`  Passed: ${result.passed ? '✅' : '❌'}`);
    console.log(`  Diff: ${result.diffPercentage.toFixed(2)}% (${result.diffPixels} pixels)`);
    console.log(`  Threshold: ${result.threshold * 100}%`);
    if (result.diffPath) {
      console.log(`  Diff saved: ${result.diffPath}`);
    }
    process.exit(result.passed ? 0 : 1);
  }).catch((error) => {
    console.error('❌ Comparison failed:', error);
    process.exit(1);
  });
}
