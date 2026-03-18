#!/usr/bin/env tsx
/**
 * Tree Shaking Audit for candy_world
 * 
 * Verifies dead code elimination effectiveness
 * Identifies unused exports and potential tree-shaking issues
 * Reports bytes that could be eliminated
 * 
 * Usage: tsx tree-shaking-audit.ts [--output ./stats/tree-shaking-report.json]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const STATS_DIR = path.join(__dirname, '../stats');
const OUTPUT_FILE = path.join(STATS_DIR, 'tree-shaking-report.json');

interface ExportInfo {
  name: string;
  type: 'function' | 'class' | 'const' | 'let' | 'var' | 'interface' | 'type' | 'enum';
  line: number;
  isUsed: boolean;
  usedIn: string[];
  size: number;
}

interface FileAudit {
  path: string;
  exports: ExportInfo[];
  imports: string[];
  unusedExports: ExportInfo[];
  treeShakingScore: number; // 0-100
}

interface TreeShakingReport {
  totalFiles: number;
  totalExports: number;
  unusedExports: number;
  totalUnusedBytes: number;
  files: FileAudit[];
  recommendations: Recommendation[];
  commonTsAudit: CommonTsAudit | null;
}

interface Recommendation {
  file: string;
  issue: string;
  suggestion: string;
  potentialSavings: number;
  priority: 'high' | 'medium' | 'low';
}

interface CommonTsAudit {
  totalExports: number;
  unusedExports: number;
  unusedFunctions: string[];
  sideEffects: boolean;
  recommendations: string[];
}

class TreeShakingAuditor {
  private report: TreeShakingReport = {
    totalFiles: 0,
    totalExports: 0,
    unusedExports: 0,
    totalUnusedBytes: 0,
    files: [],
    recommendations: [],
    commonTsAudit: null
  };

  private allExports = new Map<string, ExportInfo[]>(); // file -> exports
  private allImports = new Map<string, Set<string>>(); // file -> imported names

  async audit(): Promise<TreeShakingReport> {
    console.log('🌳 Running tree-shaking audit...');
    
    // Phase 1: Collect all exports
    console.log('  📤 Collecting exports...');
    await this.collectExports(SRC_DIR);
    
    // Phase 2: Collect all imports
    console.log('  📥 Collecting imports...');
    await this.collectImports(SRC_DIR);
    
    // Phase 3: Cross-reference usage
    console.log('  🔗 Cross-referencing usage...');
    this.analyzeUsage();
    
    // Phase 4: Special audit for common.ts
    console.log('  🔍 Auditing common.ts...');
    this.auditCommonTs();
    
    // Phase 5: Generate recommendations
    this.generateRecommendations();
    
    return this.report;
  }

  private async collectExports(dir: string, relativePath = ''): Promise<void> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);
      
      if (entry.isDirectory()) {
        await this.collectExports(fullPath, relPath);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        await this.collectFileExports(fullPath, relPath);
      }
    }
  }

  private async collectFileExports(fullPath: string, relPath: string): Promise<void> {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const exports: ExportInfo[] = [];
    const lines = content.split('\n');
    
    // Patterns for different export types
    const patterns = [
      // export function/class/const/let/var
      { regex: /export\s+(?:async\s+)?function\s+(\w+)/g, type: 'function' as const },
      { regex: /export\s+class\s+(\w+)/g, type: 'class' as const },
      { regex: /export\s+const\s+(\w+)/g, type: 'const' as const },
      { regex: /export\s+let\s+(\w+)/g, type: 'let' as const },
      { regex: /export\s+var\s+(\w+)/g, type: 'var' as const },
      { regex: /export\s+interface\s+(\w+)/g, type: 'interface' as const },
      { regex: /export\s+type\s+(\w+)/g, type: 'type' as const },
      { regex: /export\s+enum\s+(\w+)/g, type: 'enum' as const },
      // export { name1, name2 }
      { regex: /export\s*\{([^}]+)\}/g, type: 'const' as const },
      // export * from './module'
      { regex: /export\s+\*\s+from\s+['"]([^'"]+)['"]/g, type: 'const' as const },
    ];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const pattern of patterns) {
        const regex = new RegExp(pattern.regex.source, 'g');
        let match;
        
        while ((match = regex.exec(line)) !== null) {
          const name = match[1]?.trim();
          if (name) {
            // Handle multiple exports in one line: export { a, b, c }
            if (name.includes(',')) {
              const names = name.split(',').map(n => n.trim().split(' as ')[0].trim());
              for (const n of names) {
                if (n && !n.startsWith('type ')) {
                  exports.push(this.createExportInfo(n, pattern.type, i + 1, fullPath));
                }
              }
            } else {
              exports.push(this.createExportInfo(name, pattern.type, i + 1, fullPath));
            }
          }
        }
      }
      
      // Check for default export
      const defaultMatch = line.match(/export\s+default\s+(?:class|function)?\s*(\w+)/);
      if (defaultMatch) {
        exports.push(this.createExportInfo('default', 'function', i + 1, fullPath));
      }
    }
    
    this.allExports.set(relPath, exports);
    this.report.totalFiles++;
    this.report.totalExports += exports.length;
  }

  private createExportInfo(name: string, type: ExportInfo['type'], line: number, filePath: string): ExportInfo {
    return {
      name,
      type,
      line,
      isUsed: false,
      usedIn: [],
      size: 0 // Will be calculated later
    };
  }

  private async collectImports(dir: string, relativePath = ''): Promise<void> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);
      
      if (entry.isDirectory()) {
        await this.collectImports(fullPath, relPath);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        await this.collectFileImports(fullPath, relPath);
      }
    }
  }

  private async collectFileImports(fullPath: string, relPath: string): Promise<void> {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const imports = new Set<string>();
    
    // Pattern: import { name1, name2 } from './module'
    const namedImportRegex = /import\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g;
    let match;
    
    while ((match = namedImportRegex.exec(content)) !== null) {
      const names = match[1].split(',').map(n => {
        // Handle "name as alias"
        const parts = n.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim();
      });
      
      for (const name of names) {
        if (name) {
          imports.add(name);
        }
      }
    }
    
    // Pattern: import * as Namespace from './module'
    const namespaceRegex = /import\s*\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = namespaceRegex.exec(content)) !== null) {
      imports.add(match[1]); // Namespace name
    }
    
    // Pattern: import DefaultName from './module'
    const defaultRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = defaultRegex.exec(content)) !== null) {
      // Check if it's not a namespace import
      if (!match[0].includes('*')) {
        imports.add(match[1]);
        imports.add('default');
      }
    }
    
    // Pattern: import './module' (side effect)
    const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;
    while ((match = sideEffectRegex.exec(content)) !== null) {
      // Side effect imports - mark all exports from that file as potentially used
      const importedPath = match[1];
      // Resolve relative to current file
      const resolvedPath = this.resolveImportPath(importedPath, relPath);
      if (resolvedPath) {
        // Mark as side-effect import
        imports.add(`__sideEffect__${resolvedPath}`);
      }
    }
    
    this.allImports.set(relPath, imports);
  }

  private resolveImportPath(importPath: string, fromFile: string): string | null {
    // Handle relative imports
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      const fromDir = path.dirname(fromFile);
      let resolved = path.normalize(path.join(fromDir, importPath));
      
      // Try different extensions
      const extensions = ['.ts', '/index.ts', '.js'];
      for (const ext of extensions) {
        const withExt = resolved + ext;
        if (this.allExports.has(withExt)) {
          return withExt;
        }
      }
      
      // Check if path exists as-is
      if (this.allExports.has(resolved)) {
        return resolved;
      }
    }
    
    // Handle bare imports (node_modules)
    if (!importPath.startsWith('.')) {
      return `node_modules/${importPath}`;
    }
    
    return null;
  }

  private analyzeUsage(): void {
    // Mark exports as used based on imports
    for (const [importingFile, imports] of this.allImports) {
      for (const importedName of imports) {
        // Skip side-effect markers
        if (importedName.startsWith('__sideEffect__')) {
          const targetFile = importedName.replace('__sideEffect__', '');
          const exports = this.allExports.get(targetFile);
          if (exports) {
            for (const exp of exports) {
              exp.isUsed = true;
              exp.usedIn.push(importingFile);
            }
          }
          continue;
        }
        
        // Find which file exports this name
        for (const [exportingFile, exports] of this.allExports) {
          for (const exp of exports) {
            if (exp.name === importedName) {
              exp.isUsed = true;
              exp.usedIn.push(importingFile);
            }
          }
        }
      }
    }
    
    // Special handling: mark exports used within the same file
    for (const [filePath, exports] of this.allExports) {
      const content = fs.readFileSync(path.join(SRC_DIR, filePath), 'utf-8');
      
      for (const exp of exports) {
        if (exp.name === 'default') continue; // Default exports are entry points
        
        // Check if used within the file itself
        const usageRegex = new RegExp(`\\b${exp.name}\\b`, 'g');
        const matches = content.match(usageRegex);
        
        // If used more times than just the export declaration
        if (matches && matches.length > 1) {
          // It's used internally, but might still be tree-shaken if not exported
          // We still count it as "unused export" if no other file imports it
        }
      }
    }
    
    // Build report
    for (const [filePath, exports] of this.allExports) {
      const unusedExports = exports.filter(e => !e.isUsed);
      const usedExports = exports.filter(e => e.isUsed);
      
      // Calculate approximate sizes
      const content = fs.readFileSync(path.join(SRC_DIR, filePath), 'utf-8');
      const avgSizePerExport = content.length / Math.max(exports.length, 1);
      
      for (const exp of unusedExports) {
        exp.size = Math.floor(avgSizePerExport);
        this.report.totalUnusedBytes += exp.size;
      }
      
      const fileAudit: FileAudit = {
        path: filePath,
        exports,
        imports: Array.from(this.allImports.get(filePath) || []),
        unusedExports,
        treeShakingScore: exports.length > 0 
          ? Math.round((usedExports.length / exports.length) * 100)
          : 100
      };
      
      this.report.files.push(fileAudit);
      this.report.unusedExports += unusedExports.length;
    }
    
    // Sort by unused exports count
    this.report.files.sort((a, b) => b.unusedExports.length - a.unusedExports.length);
  }

  private auditCommonTs(): void {
    const commonTsPath = 'foliage/common.ts';
    const exports = this.allExports.get(commonTsPath);
    
    if (!exports) {
      this.report.commonTsAudit = null;
      return;
    }
    
    const unused = exports.filter(e => !e.isUsed);
    const unusedFunctionNames = unused
      .filter(e => e.type === 'function')
      .map(e => e.name);
    
    // Check for side effects in common.ts
    const content = fs.readFileSync(path.join(SRC_DIR, commonTsPath), 'utf-8');
    const hasSideEffects = 
      content.includes('console.') ||
      content.includes('window.') ||
      content.includes('document.') ||
      /\bnew\s+\w+\([^)]*\)/.test(content) || // Instantiation
      /\w+\s*\([^)]*\)/.test(content.split('\n')[0]); // Function call at top level
    
    const recommendations: string[] = [];
    
    if (unused.length > 5) {
      recommendations.push(`Consider splitting common.ts into smaller modules. ${unused.length} unused exports detected.`);
    }
    
    if (hasSideEffects) {
      recommendations.push('common.ts may have side effects. Add "sideEffects": false to package.json for better tree-shaking.');
    }
    
    if (unusedFunctionNames.length > 0) {
      recommendations.push(`Remove unused functions: ${unusedFunctionNames.slice(0, 5).join(', ')}${unusedFunctionNames.length > 5 ? '...' : ''}`);
    }
    
    // Check for Three.js tree-shaking issues
    const threeImports = content.match(/from\s+['"]three[^'"]*['"]/g);
    if (threeImports) {
      recommendations.push('Using Three.js imports. Ensure you\'re importing only needed modules for better tree-shaking.');
    }
    
    this.report.commonTsAudit = {
      totalExports: exports.length,
      unusedExports: unused.length,
      unusedFunctions: unusedFunctionNames,
      sideEffects: hasSideEffects,
      recommendations
    };
  }

  private generateRecommendations(): void {
    // Find files with many unused exports
    for (const file of this.report.files) {
      if (file.unusedExports.length >= 3) {
        this.report.recommendations.push({
          file: file.path,
          issue: `${file.unusedExports.length} unused exports`,
          suggestion: 'Remove unused exports or split into smaller modules',
          potentialSavings: file.unusedExports.reduce((sum, e) => sum + e.size, 0),
          priority: file.unusedExports.length > 5 ? 'high' : 'medium'
        });
      }
      
      // Check for low tree-shaking score
      if (file.treeShakingScore < 50 && file.exports.length > 5) {
        this.report.recommendations.push({
          file: file.path,
          issue: `Low tree-shaking score (${file.treeShakingScore}%)`,
          suggestion: 'Review export structure. Consider using explicit exports instead of wildcards.',
          potentialSavings: file.unusedExports.reduce((sum, e) => sum + e.size, 0),
          priority: 'medium'
        });
      }
    }
    
    // Sort by priority and potential savings
    this.report.recommendations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return b.potentialSavings - a.potentialSavings;
    });
  }

  generateReport(outputPath: string = OUTPUT_FILE): void {
    console.log(`  📝 Generating report: ${outputPath}`);
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write JSON report
    fs.writeFileSync(outputPath, JSON.stringify(this.report, null, 2));
    
    // Generate human-readable markdown report
    const mdPath = outputPath.replace('.json', '.md');
    fs.writeFileSync(mdPath, this.generateMarkdownReport());
    
    console.log(`  ✅ Reports saved:`);
    console.log(`     JSON: ${outputPath}`);
    console.log(`     Markdown: ${mdPath}`);
  }

  private generateMarkdownReport(): string {
    const score = this.report.totalExports > 0 
      ? Math.round(((this.report.totalExports - this.report.unusedExports) / this.report.totalExports) * 100)
      : 100;
    
    let md = `# 🌳 Tree Shaking Audit Report\n\n`;
    md += `**Overall Tree-Shaking Score: ${score}%**\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Total Files | ${this.report.totalFiles} |\n`;
    md += `| Total Exports | ${this.report.totalExports} |\n`;
    md += `| Unused Exports | ${this.report.unusedExports} (${((this.report.unusedExports / this.report.totalExports) * 100).toFixed(1)}%) |\n`;
    md += `| Potential Savings | ${this.formatBytes(this.report.totalUnusedBytes)} |\n\n`;
    
    // Common.ts audit
    if (this.report.commonTsAudit) {
      md += `## 📋 common.ts Analysis\n\n`;
      md += `| Metric | Value |\n`;
      md += `|--------|-------|\n`;
      md += `| Total Exports | ${this.report.commonTsAudit.totalExports} |\n`;
      md += `| Unused Exports | ${this.report.commonTsAudit.unusedExports} |\n`;
      md += `| Side Effects | ${this.report.commonTsAudit.sideEffects ? '⚠️ Yes' : '✅ No'} |\n\n`;
      
      if (this.report.commonTsAudit.unusedFunctions.length > 0) {
        md += `### Unused Functions in common.ts\n\n`;
        for (const fn of this.report.commonTsAudit.unusedFunctions) {
          md += `- \`${fn}\`\n`;
        }
        md += '\n';
      }
      
      if (this.report.commonTsAudit.recommendations.length > 0) {
        md += `### Recommendations\n\n`;
        for (const rec of this.report.commonTsAudit.recommendations) {
          md += `- ${rec}\n`;
        }
        md += '\n';
      }
    }
    
    // Files with most unused exports
    md += `## 📁 Files with Unused Exports\n\n`;
    const filesWithUnused = this.report.files.filter(f => f.unusedExports.length > 0).slice(0, 20);
    
    for (const file of filesWithUnused) {
      md += `### ${file.path}\n\n`;
      md += `- **Tree-Shaking Score:** ${file.treeShakingScore}%\n`;
      md += `- **Unused Exports:** ${file.unusedExports.length}/${file.exports.length}\n\n`;
      
      if (file.unusedExports.length > 0) {
        md += `| Export | Type | Line |\n`;
        md += `|--------|------|------|\n`;
        for (const exp of file.unusedExports.slice(0, 10)) {
          md += `| \`${exp.name}\` | ${exp.type} | ${exp.line} |\n`;
        }
        if (file.unusedExports.length > 10) {
          md += `| ... and ${file.unusedExports.length - 10} more | | |\n`;
        }
        md += '\n';
      }
    }
    
    // Recommendations
    if (this.report.recommendations.length > 0) {
      md += `## 💡 Recommendations\n\n`;
      
      const highPriority = this.report.recommendations.filter(r => r.priority === 'high');
      const mediumPriority = this.report.recommendations.filter(r => r.priority === 'medium');
      
      if (highPriority.length > 0) {
        md += `### 🔴 High Priority\n\n`;
        for (const rec of highPriority.slice(0, 10)) {
          md += `**${rec.file}**\n`;
          md += `- Issue: ${rec.issue}\n`;
          md += `- Suggestion: ${rec.suggestion}\n`;
          md += `- Potential Savings: ${this.formatBytes(rec.potentialSavings)}\n\n`;
        }
      }
      
      if (mediumPriority.length > 0) {
        md += `### 🟡 Medium Priority\n\n`;
        for (const rec of mediumPriority.slice(0, 10)) {
          md += `**${rec.file}**\n`;
          md += `- Issue: ${rec.issue}\n`;
          md += `- Suggestion: ${rec.suggestion}\n`;
          md += `- Potential Savings: ${this.formatBytes(rec.potentialSavings)}\n\n`;
        }
      }
    }
    
    // Tree-shaking best practices
    md += `## 📚 Tree-Shaking Best Practices\n\n`;
    md += `1. **Use explicit exports** - Avoid \`export * from './module'\` when possible\n`;
    md += `2. **Mark side effects** - Add \`"sideEffects": false\` to package.json\n`;
    md += `3. **Avoid barrel files** - Direct imports enable better tree-shaking\n`;
    md += `4. **Use ES modules** - Ensure all dependencies are ES modules\n`;
    md += `5. **Check dead code** - Remove unused functions and variables\n`;
    md += `6. **Dynamic imports** - Use \`import()\` for code-splitting optional features\n\n`;
    
    return md;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : OUTPUT_FILE;
  
  const auditor = new TreeShakingAuditor();
  
  try {
    const report = await auditor.audit();
    auditor.generateReport(outputPath);
    
    console.log('\n📊 Summary:');
    console.log(`   Files Analyzed: ${report.totalFiles}`);
    console.log(`   Total Exports: ${report.totalExports}`);
    console.log(`   Unused Exports: ${report.unusedExports} (${((report.unusedExports / report.totalExports) * 100).toFixed(1)}%)`);
    console.log(`   Potential Savings: ${(report.totalUnusedBytes / 1024).toFixed(2)} KB`);
    
    if (report.commonTsAudit) {
      console.log(`\n   common.ts: ${report.commonTsAudit.unusedExports}/${report.commonTsAudit.totalExports} unused exports`);
    }
  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  }
}

main();
