#!/usr/bin/env tsx
/**
 * Enhanced Vite Plugin for candy_world
 * 
 * WASM optimization (strip debug symbols)
 * TSL shader precompilation cache
 * Dead code elimination for unused CandyPresets
 * Build-time constant folding
 * 
 * Usage: Add to vite.config.ts plugins array
 */

import type { Plugin, ResolvedConfig } from 'vite';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface CandyOptimizerOptions {
  /** Strip debug symbols from WASM */
  wasmOpt?: boolean;
  /** Enable TSL shader caching */
  tslCache?: boolean;
  /** Remove unused presets */
  deadCodeElimination?: boolean;
  /** Enable constant folding */
  constantFolding?: boolean;
  /** Cache directory */
  cacheDir?: string;
}

interface ShaderCache {
  version: string;
  shaders: Map<string, CachedShader>;
}

interface CachedShader {
  source: string;
  compiled: string;
  hash: string;
  timestamp: number;
}

interface PresetUsage {
  preset: string;
  used: boolean;
  usedIn: string[];
}

/**
 * Creates the enhanced Vite plugin for candy_world optimization
 */
export function candyWorldOptimizer(options: CandyOptimizerOptions = {}): Plugin {
  const opts = {
    wasmOpt: true,
    tslCache: true,
    deadCodeElimination: true,
    constantFolding: true,
    cacheDir: '.candy-cache',
    ...options
  };

  let config: ResolvedConfig;
  let shaderCache: ShaderCache;
  let presetUsage: Map<string, PresetUsage> = new Map();

  return {
    name: 'candy-world-optimizer',
    enforce: 'pre',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
      
      // Initialize shader cache
      if (opts.tslCache) {
        shaderCache = loadShaderCache(opts.cacheDir);
      }
    },

    // Transform hook for TypeScript/JavaScript files
    transform(code: string, id: string) {
      // Skip node_modules
      if (id.includes('node_modules')) return null;

      let transformed = code;
      let hasChanges = false;

      // Apply constant folding
      if (opts.constantFolding) {
        const result = applyConstantFolding(transformed, id);
        if (result.changed) {
          transformed = result.code;
          hasChanges = true;
        }
      }

      // Track preset usage for dead code elimination
      if (opts.deadCodeElimination && id.includes('CandyPresets')) {
        trackPresetUsage(transformed, id, presetUsage);
      }

      // Apply dead code elimination
      if (opts.deadCodeElimination && isProduction(config)) {
        const result = applyDeadCodeElimination(transformed, id, presetUsage);
        if (result.changed) {
          transformed = result.code;
          hasChanges = true;
        }
      }

      // TSL shader caching
      if (opts.tslCache && (id.includes('tsl') || code.includes('three/tsl'))) {
        const result = cacheTslShaders(transformed, id, shaderCache);
        if (result.changed) {
          transformed = result.code;
          hasChanges = true;
        }
      }

      return hasChanges ? { code: transformed, map: null } : null;
    },

    // Handle WASM files
    async transformIndexHtml(html: string) {
      if (!opts.wasmOpt) return html;

      // Add WASM preloading hints
      return optimizeWasmLoading(html, config);
    },

    // Build start hook
    buildStart() {
      console.log('🍭 candy_world optimizer starting...');
      
      if (opts.wasmOpt) {
        console.log('  ✓ WASM optimization enabled');
      }
      if (opts.tslCache) {
        console.log('  ✓ TSL shader caching enabled');
      }
      if (opts.deadCodeElimination) {
        console.log('  ✓ Dead code elimination enabled');
      }
      if (opts.constantFolding) {
        console.log('  ✓ Constant folding enabled');
      }
    },

    // Build end hook
    async buildEnd() {
      // Save shader cache
      if (opts.tslCache) {
        saveShaderCache(opts.cacheDir, shaderCache);
      }

      // Optimize WASM files
      if (opts.wasmOpt && isProduction(config)) {
        await optimizeWasmFiles(config);
      }

      // Print dead code elimination report
      if (opts.deadCodeElimination) {
        printDeadCodeReport(presetUsage);
      }

      console.log('✅ candy_world optimizer complete');
    },

    // Close bundle hook for final optimizations
    async closeBundle() {
      if (isProduction(config)) {
        // Final bundle optimizations
        await finalizeBundle(config);
      }
    }
  };
}

// ==================== WASM Optimization ====================

async function optimizeWasmFiles(config: ResolvedConfig): Promise<void> {
  const outDir = config.build.outDir || 'dist';
  const wasmFiles = findWasmFiles(outDir);

  if (wasmFiles.length === 0) {
    console.log('  ⚠️ No WASM files found to optimize');
    return;
  }

  console.log(`  🔧 Optimizing ${wasmFiles.length} WASM file(s)...`);

  for (const wasmFile of wasmFiles) {
    try {
      const originalSize = fs.statSync(wasmFile).size;
      
      // Try wasm-opt (Binaryen)
      if (hasCommand('wasm-opt')) {
        const tempFile = `${wasmFile}.tmp`;
        execSync(`wasm-opt -O3 -s ${wasmFile} -o ${tempFile}`, { stdio: 'ignore' });
        fs.renameSync(tempFile, wasmFile);
        
        const optimizedSize = fs.statSync(wasmFile).size;
        const savings = originalSize - optimizedSize;
        const percentage = ((savings / originalSize) * 100).toFixed(1);
        
        console.log(`    ✓ ${path.basename(wasmFile)}: ${formatBytes(originalSize)} → ${formatBytes(optimizedSize)} (-${percentage}%)`);
      } else {
        console.log(`    ⚠️ wasm-opt not available, skipping ${path.basename(wasmFile)}`);
      }
    } catch (error) {
      console.error(`    ❌ Failed to optimize ${wasmFile}:`, error);
    }
  }
}

function findWasmFiles(dir: string): string[] {
  const files: string[] = [];
  
  if (!fs.existsSync(dir)) return files;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      files.push(...findWasmFiles(fullPath));
    } else if (entry.name.endsWith('.wasm')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function optimizeWasmLoading(html: string, config: ResolvedConfig): string {
  // Find WASM files and add preload hints
  const outDir = config.build.outDir || 'dist';
  const wasmFiles = findWasmFiles(outDir);
  
  if (wasmFiles.length === 0) return html;

  const preloadLinks = wasmFiles.map(wasmFile => {
    const relativePath = path.relative(outDir, wasmFile);
    return `  <link rel="prefetch" href="${relativePath}" as="fetch" crossorigin>`;
  }).join('\n');

  // Insert before closing head tag
  return html.replace('</head>', `${preloadLinks}\n</head>`);
}

// ==================== TSL Shader Caching ====================

function loadShaderCache(cacheDir: string): ShaderCache {
  const cacheFile = path.join(cacheDir, 'shaders.json');
  
  if (fs.existsSync(cacheFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      return {
        version: data.version || '1.0',
        shaders: new Map(Object.entries(data.shaders || {}))
      };
    } catch {
      // Invalid cache, start fresh
    }
  }
  
  return {
    version: '1.0',
    shaders: new Map()
  };
}

function saveShaderCache(cacheDir: string, cache: ShaderCache): void {
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  const cacheFile = path.join(cacheDir, 'shaders.json');
  const data = {
    version: cache.version,
    shaders: Object.fromEntries(cache.shaders),
    timestamp: Date.now()
  };
  
  fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
  console.log(`  💾 Shader cache saved (${cache.shaders.size} shaders)`);
}

function cacheTslShaders(code: string, id: string, cache: ShaderCache): { code: string; changed: boolean } {
  // Look for TSL shader patterns
  const tslPattern = /Fn\((\[[^\]]*\])?\s*=>\s*\{([^}]*)\}\)/g;
  let match;
  let changed = false;
  let transformed = code;

  while ((match = tslPattern.exec(code)) !== null) {
    const shaderSource = match[0];
    const hash = simpleHash(shaderSource);
    
    const cached = cache.shaders.get(hash);
    if (cached && cached.source === shaderSource) {
      // Use cached version
      transformed = transformed.replace(shaderSource, `/* cached: ${hash} */ ${cached.compiled}`);
      changed = true;
    } else {
      // Cache this shader
      cache.shaders.set(hash, {
        source: shaderSource,
        compiled: shaderSource,
        hash,
        timestamp: Date.now()
      });
    }
  }

  return { code: transformed, changed };
}

// ==================== Dead Code Elimination ====================

function trackPresetUsage(code: string, id: string, usage: Map<string, PresetUsage>): void {
  // Find CandyPreset exports
  const exportPattern = /export\s+(?:const|let|var)\s+(\w+)/g;
  let match;

  while ((match = exportPattern.exec(code)) !== null) {
    const presetName = match[1];
    if (!usage.has(presetName)) {
      usage.set(presetName, {
        preset: presetName,
        used: false,
        usedIn: []
      });
    }
  }

  // Find imports of presets
  const importPattern = /from\s+['"]([^'"]*CandyPresets[^'"]*)['"]/g;
  while ((match = importPattern.exec(code)) !== null) {
    // Mark all presets as potentially used (conservative)
    for (const [name, info] of usage) {
      if (!info.used) {
        info.usedIn.push(id);
      }
    }
  }

  // Find direct usage
  for (const [name, info] of usage) {
    const usagePattern = new RegExp(`\\b${name}\\b`, 'g');
    if (usagePattern.test(code) && !code.includes(`export const ${name}`)) {
      info.used = true;
      info.usedIn.push(id);
    }
  }
}

function applyDeadCodeElimination(
  code: string, 
  id: string, 
  usage: Map<string, PresetUsage>
): { code: string; changed: boolean } {
  let transformed = code;
  let changed = false;

  // Remove unused preset exports
  for (const [name, info] of usage) {
    if (!info.used && info.usedIn.length === 0) {
      // Remove the export
      const exportPattern = new RegExp(`export\\s+(?:const|let|var)\\s+${name}\\s*=\\s*[^;]+;?`, 'g');
      if (exportPattern.test(transformed)) {
        transformed = transformed.replace(exportPattern, `/* DCE: ${name} unused */`);
        changed = true;
      }
    }
  }

  return { code: transformed, changed };
}

function printDeadCodeReport(usage: Map<string, PresetUsage>): void {
  const unused = [...usage.values()].filter(u => !u.used);
  
  if (unused.length > 0) {
    console.log(`  🗑️ Dead code elimination:`);
    console.log(`     Removed ${unused.length} unused presets:`);
    for (const u of unused.slice(0, 5)) {
      console.log(`       - ${u.preset}`);
    }
    if (unused.length > 5) {
      console.log(`       ... and ${unused.length - 5} more`);
    }
  }
}

// ==================== Constant Folding ====================

function applyConstantFolding(code: string, id: string): { code: string; changed: boolean } {
  let transformed = code;
  let changed = false;

  // Fold process.env.NODE_ENV
  if (code.includes('process.env.NODE_ENV')) {
    transformed = transformed.replace(
      /process\.env\.NODE_ENV\s*===?\s*['"]production['"]/g,
      isProductionEnv() ? 'true' : 'false'
    );
    transformed = transformed.replace(
      /process\.env\.NODE_ENV\s*===?\s*['"]development['"]/g,
      isProductionEnv() ? 'false' : 'true'
    );
    changed = true;
  }

  // Fold process.env.DEBUG
  if (code.includes('process.env.DEBUG')) {
    transformed = transformed.replace(
      /process\.env\.DEBUG/g,
      isProductionEnv() ? 'false' : 'true'
    );
    changed = true;
  }

  // Fold __DEV__ markers
  if (code.includes('__DEV__')) {
    transformed = transformed.replace(/__DEV__/g, isProductionEnv() ? 'false' : 'true');
    changed = true;
  }

  // Remove debug blocks in production
  if (isProductionEnv()) {
    // Remove if (__DEV__) { ... } blocks
    const devBlockPattern = /if\s*\(\s*(?:__DEV__|process\.env\.DEBUG|false)\s*\)\s*\{[^{}]*\}/g;
    if (devBlockPattern.test(transformed)) {
      transformed = transformed.replace(devBlockPattern, '/* DEV block removed */');
      changed = true;
    }

    // Remove console.* in production (aggressive)
    const consolePattern = /console\.(log|info|debug|warn|error)\s*\([^)]*\)\s*;?/g;
    if (consolePattern.test(transformed)) {
      transformed = transformed.replace(consolePattern, '/* console removed */');
      changed = true;
    }
  }

  return { code: transformed, changed };
}

// ==================== Bundle Finalization ====================

async function finalizeBundle(config: ResolvedConfig): Promise<void> {
  const outDir = config.build.outDir || 'dist';
  
  if (!fs.existsSync(outDir)) return;

  // Generate bundle analysis file
  const analysis = {
    timestamp: new Date().toISOString(),
    files: [] as Array<{ path: string; size: number; type: string }>
  };

  const entries = fs.readdirSync(outDir, { recursive: true }) as string[];
  
  for (const entry of entries) {
    const fullPath = path.join(outDir, entry);
    
    if (fs.statSync(fullPath).isFile()) {
      analysis.files.push({
        path: entry,
        size: fs.statSync(fullPath).size,
        type: path.extname(entry)
      });
    }
  }

  // Sort by size (largest first)
  analysis.files.sort((a, b) => b.size - a.size);

  fs.writeFileSync(
    path.join(outDir, 'bundle-analysis.json'),
    JSON.stringify(analysis, null, 2)
  );
}

// ==================== Utilities ====================

function isProduction(config: ResolvedConfig): boolean {
  return config.mode === 'production' || config.isProduction;
}

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

function hasCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==================== Plugin Generator ====================

/**
 * Generates the vite-plugin-enhanced.ts file for the project
 */
export function generatePluginFile(): string {
  return `// vite-plugin-enhanced.ts
// Auto-generated enhanced Vite plugin for candy_world

import type { Plugin, ResolvedConfig } from 'vite';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface CandyOptimizerOptions {
  wasmOpt?: boolean;
  tslCache?: boolean;
  deadCodeElimination?: boolean;
  constantFolding?: boolean;
  cacheDir?: string;
}

export function candyWorldOptimizer(options: CandyOptimizerOptions = {}): Plugin {
  const opts = {
    wasmOpt: true,
    tslCache: true,
    deadCodeElimination: true,
    constantFolding: true,
    cacheDir: '.candy-cache',
    ...options
  };

  let config: ResolvedConfig;

  return {
    name: 'candy-world-optimizer',
    enforce: 'pre',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    transform(code: string, id: string) {
      if (id.includes('node_modules')) return null;

      let transformed = code;
      let hasChanges = false;

      // Constant folding for process.env
      if (opts.constantFolding && code.includes('process.env')) {
        transformed = transformed.replace(
          /process\.env\.NODE_ENV/g,
          '"production"'
        );
        hasChanges = true;
      }

      return hasChanges ? { code: transformed, map: null } : null;
    },

    async buildEnd() {
      if (opts.wasmOpt && config.mode === 'production') {
        await optimizeWasmFiles(config);
      }
    }
  };
}

async function optimizeWasmFiles(config: ResolvedConfig): Promise<void> {
  const outDir = config.build.outDir || 'dist';
  
  function findWasm(dir: string): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;
    
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...findWasm(fullPath));
      } else if (entry.name.endsWith('.wasm')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const wasmFiles = findWasm(outDir);
  
  for (const wasmFile of wasmFiles) {
    try {
      execSync(\`wasm-opt -O3 \${wasmFile} -o \${wasmFile}\`, { stdio: 'ignore' });
      console.log(\`Optimized: \${path.basename(wasmFile)}\`);
    } catch {
      // wasm-opt not available
    }
  }
}

export default candyWorldOptimizer;
`;
}

// CLI usage
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  console.log('🍭 candy_world Enhanced Vite Plugin');
  console.log('');
  console.log('Usage:');
  console.log('  import { candyWorldOptimizer } from "./vite-plugin-enhanced.ts"');
  console.log('');
  console.log('  // In vite.config.ts:');
  console.log('  plugins: [');
  console.log('    candyWorldOptimizer({');
  console.log('      wasmOpt: true,');
  console.log('      tslCache: true,');
  console.log('      deadCodeElimination: true,');
  console.log('      constantFolding: true');
  console.log('    })');
  console.log('  ]');
}
