/**
 * Candy World Visual Regression Testing System
 * 
 * A comprehensive visual regression testing and screenshot comparison system
 * for candy_world. Automatically detect visual bugs and performance regressions
 * by capturing and comparing screenshots across different builds.
 */

export { ScreenshotCapture, VIEWPOINTS, QUALITY_SETTINGS, VIEWPORTS } from './src/screenshot-capture.js';
export type { 
  ViewportConfig, 
  QualitySetting, 
  QualityConfig, 
  Viewpoint, 
  ScreenshotOptions 
} from './src/screenshot-capture.js';

export { ScreenshotComparator } from './src/screenshot-compare.js';
export type { ComparisonOptions, ComparisonResult } from './src/screenshot-compare.js';

export { BaselineManager } from './src/baseline-manager.js';
export type { BaselineManagerConfig, BaselineEntry } from './src/baseline-manager.js';

export { PerformanceScreenshotCapture } from './src/performance-screenshot.js';
export type { 
  GPUMetrics, 
  PixelHeatmap, 
  PerformanceScreenshotOptions, 
  PerformanceScreenshotResult 
} from './src/performance-screenshot.js';

export { ReportGenerator } from './src/report-generator.js';
export type { ReportConfig, ReportData } from './src/report-generator.js';

export { runVisualTests, loadConfig, DEFAULT_CONFIG } from './cli.js';
