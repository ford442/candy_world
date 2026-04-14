/**
 * Utility functions for visual regression testing
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Parse filename to extract viewpoint, quality, and viewport
 */
export function parseScreenshotFilename(filename: string): {
  viewpoint: string | null;
  quality: string | null;
  viewport: string | null;
  timestamp: string | null;
} {
  const match = filename.match(/^(\w+)-(low|medium|high|ultra)-(mobile|desktop|ultrawide|tablet)-(.+)\.png$/);
  
  if (!match) {
    return { viewpoint: null, quality: null, viewport: null, timestamp: null };
  }
  
  const [, viewpoint, quality, viewport, timestamp] = match;
  return { viewpoint, quality, viewport, timestamp };
}

/**
 * Ensure directory exists
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Get all PNG files in a directory recursively
 */
export function getPNGFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...getPNGFiles(fullPath));
    } else if (entry.name.endsWith('.png') && !entry.name.startsWith('diff-')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Calculate image similarity score (0-100)
 */
export function calculateSimilarity(diffPercentage: number): number {
  return Math.max(0, Math.min(100, 100 - diffPercentage));
}

/**
 * Wait for a condition with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 120000,
  interval: number = 100
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  return false;
}

/**
 * Color codes for terminal output
 */
export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

/**
 * Print colored message
 */
export function print(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Create a progress bar string
 */
export function createProgressBar(
  current: number,
  total: number,
  width: number = 30
): string {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${current}/${total}`;
}

/**
 * Group screenshots by viewpoint
 */
export function groupByViewpoint(filePaths: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  
  for (const path of filePaths) {
    const filename = path.split('/').pop() || '';
    const { viewpoint } = parseScreenshotFilename(filename);
    
    if (viewpoint) {
      if (!groups.has(viewpoint)) {
        groups.set(viewpoint, []);
      }
      groups.get(viewpoint)!.push(path);
    }
  }
  
  return groups;
}

/**
 * Validate screenshot file
 */
export async function validateScreenshot(filePath: string): Promise<{
  valid: boolean;
  width?: number;
  height?: number;
  error?: string;
}> {
  try {
    const { PNG } = await import('pngjs');
    const data = fs.readFileSync(filePath);
    const png = PNG.sync.read(data);
    
    return {
      valid: true,
      width: png.width,
      height: png.height
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
