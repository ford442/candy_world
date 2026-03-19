import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Baseline Manager Configuration
 */
export interface BaselineManagerConfig {
  baselineDir: string;
  branchIsolation?: boolean;
  useGitLFS?: boolean;
  gitLFSAttributes?: string[];
}

/**
 * Baseline Entry Metadata
 */
export interface BaselineEntry {
  name: string;
  path: string;
  hash: string;
  timestamp: string;
  branch: string;
  commit: string;
  tags: string[];
  viewpoint: string;
  quality: string;
  viewport: string;
}

/**
 * Baseline Index
 */
interface BaselineIndex {
  version: number;
  lastUpdated: string;
  entries: BaselineEntry[];
}

/**
 * Baseline Manager
 * 
 * Handles version control of baseline screenshots with:
 * - Branch-based isolation
 * - Git LFS integration for large files
 * - Metadata tracking
 * - Update workflows for intentional changes
 */
export class BaselineManager {
  private config: Required<BaselineManagerConfig>;
  private index: BaselineIndex;
  private indexPath: string;

  constructor(config: BaselineManagerConfig) {
    this.config = {
      branchIsolation: true,
      useGitLFS: true,
      gitLFSAttributes: ['*.png filter=lfs diff=lfs merge=lfs -text'],
      ...config
    };
    this.indexPath = path.join(this.config.baselineDir, 'index.json');
    this.index = this.loadIndex();
  }

  /**
   * Initialize baseline directory and Git LFS
   */
  async init(): Promise<void> {
    // Create baseline directory
    fs.mkdirSync(this.config.baselineDir, { recursive: true });

    // Set up Git LFS if enabled
    if (this.config.useGitLFS) {
      await this.setupGitLFS();
    }

    // Create .gitignore if it doesn't exist
    const gitignorePath = path.join(this.config.baselineDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '# Ignore temporary files\n*.tmp\n*.diff\n');
    }

    console.log(`✅ Baseline directory initialized at ${this.config.baselineDir}`);
  }

  /**
   * Set up Git LFS for large PNG files
   */
  private async setupGitLFS(): Promise<void> {
    try {
      // Check if git lfs is installed
      execSync('git lfs version', { stdio: 'ignore' });
    } catch {
      console.warn('⚠️  Git LFS not installed. Large files will be tracked normally.');
      return;
    }

    const gitattributesPath = path.join(this.config.baselineDir, '.gitattributes');
    
    if (!fs.existsSync(gitattributesPath)) {
      fs.writeFileSync(
        gitattributesPath,
        this.config.gitLFSAttributes.join('\n') + '\n'
      );
      console.log('✅ Git LFS attributes configured');
    }
  }

  /**
   * Load baseline index
   */
  private loadIndex(): BaselineIndex {
    if (fs.existsSync(this.indexPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
      } catch {
        console.warn('⚠️  Failed to parse baseline index, creating new one');
      }
    }
    
    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      entries: []
    };
  }

  /**
   * Save baseline index
   */
  private saveIndex(): void {
    this.index.lastUpdated = new Date().toISOString();
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  /**
   * Get current git branch
   */
  private getCurrentBranch(): string {
    try {
      return execSync('git branch --show-current', { 
        encoding: 'utf-8',
        cwd: process.cwd()
      }).trim();
    } catch {
      return 'main';
    }
  }

  /**
   * Get current git commit
   */
  private getCurrentCommit(): string {
    try {
      return execSync('git rev-parse HEAD', {
        encoding: 'utf-8',
        cwd: process.cwd()
      }).trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Calculate file hash
   */
  private async calculateHash(filepath: string): Promise<string> {
    const crypto = await import('crypto');
    const content = fs.readFileSync(filepath);
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Add a new baseline
   */
  async addBaseline(
    sourcePath: string,
    options: {
      viewpoint: string;
      quality: string;
      viewport: string;
      tags?: string[];
      name?: string;
    }
  ): Promise<BaselineEntry> {
    const branch = this.getCurrentBranch();
    const targetDir = this.config.branchIsolation
      ? path.join(this.config.baselineDir, branch)
      : this.config.baselineDir;

    fs.mkdirSync(targetDir, { recursive: true });

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = options.name || 
      `${options.viewpoint}-${options.quality}-${options.viewport}-${timestamp}.png`;
    const targetPath = path.join(targetDir, filename);

    // Copy file
    fs.copyFileSync(sourcePath, targetPath);

    // Create entry
    const entry: BaselineEntry = {
      name: filename,
      path: targetPath,
      hash: await this.calculateHash(targetPath),
      timestamp: new Date().toISOString(),
      branch,
      commit: this.getCurrentCommit(),
      tags: options.tags || [],
      viewpoint: options.viewpoint,
      quality: options.quality,
      viewport: options.viewport
    };

    // Add to index, replacing any existing entry for this viewpoint/quality/viewport combo
    this.index.entries = this.index.entries.filter(e => 
      !(e.viewpoint === options.viewpoint && 
        e.quality === options.quality && 
        e.viewport === options.viewport &&
        e.branch === branch)
    );
    this.index.entries.push(entry);
    this.saveIndex();

    console.log(`✅ Added baseline: ${filename}`);
    return entry;
  }

  /**
   * Get baseline for a specific configuration
   */
  async getBaseline(
    viewpoint: string,
    quality: string,
    viewport: string,
    branch?: string
  ): Promise<BaselineEntry | null> {
    const targetBranch = branch || this.getCurrentBranch();

    // Try exact branch match first
    let entry = this.index.entries.find(e =>
      e.viewpoint === viewpoint &&
      e.quality === quality &&
      e.viewport === viewport &&
      e.branch === targetBranch
    );

    // Fall back to main if not found and branch isolation is enabled
    if (!entry && this.config.branchIsolation && targetBranch !== 'main') {
      entry = this.index.entries.find(e =>
        e.viewpoint === viewpoint &&
        e.quality === quality &&
        e.viewport === viewport &&
        e.branch === 'main'
      );
    }

    return entry || null;
  }

  /**
   * Get all baselines for a branch
   */
  getBranchBaselines(branch?: string): BaselineEntry[] {
    const targetBranch = branch || this.getCurrentBranch();
    return this.index.entries.filter(e => e.branch === targetBranch);
  }

  /**
   * Update baselines from current screenshots (for intentional changes)
   */
  async updateBaselines(
    screenshotsDir: string,
    options: {
      viewpoint?: string;
      quality?: string;
      viewport?: string;
      tags?: string[];
      force?: boolean;
    } = {}
  ): Promise<BaselineEntry[]> {
    const updated: BaselineEntry[] = [];
    const files = fs.readdirSync(screenshotsDir)
      .filter(f => f.endsWith('.png'))
      .filter(f => !f.startsWith('diff-'));

    for (const file of files) {
      const match = file.match(/^(\w+)-(low|medium|high|ultra)-(mobile|desktop|ultrawide|tablet)/);
      if (!match) continue;

      const [, vp, quality, viewport] = match;

      // Skip if filters don't match
      if (options.viewpoint && vp !== options.viewpoint) continue;
      if (options.quality && quality !== options.quality) continue;
      if (options.viewport && viewport !== options.viewport) continue;

      const sourcePath = path.join(screenshotsDir, file);
      
      // Check if different from existing baseline
      const existing = await this.getBaseline(vp, quality, viewport);
      if (existing && !options.force) {
        const newHash = await this.calculateHash(sourcePath);
        if (newHash === existing.hash) {
          console.log(`⏭️  Skipping unchanged baseline: ${file}`);
          continue;
        }
      }

      const entry = await this.addBaseline(sourcePath, {
        viewpoint: vp,
        quality,
        viewport,
        tags: [...(options.tags || []), 'updated']
      });

      updated.push(entry);
    }

    console.log(`\n✅ Updated ${updated.length} baselines`);
    return updated;
  }

  /**
   * Clean up old baselines
   */
  cleanup(options: {
    keepPerConfig?: number;
    olderThan?: number; // days
    dryRun?: boolean;
  } = {}): { removed: number; freed: number } {
    const { keepPerConfig = 5, olderThan = 30, dryRun = false } = options;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThan);

    // Group entries by viewpoint/quality/viewport combo
    const groups = new Map<string, BaselineEntry[]>();
    
    for (const entry of this.index.entries) {
      const key = `${entry.viewpoint}-${entry.quality}-${entry.viewport}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }

    let removed = 0;
    let freed = 0;

    for (const [key, entries] of groups) {
      // Sort by timestamp, newest first
      entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Remove old entries beyond keep count
      const toRemove = entries.slice(keepPerConfig)
        .filter(e => new Date(e.timestamp) < cutoffDate);

      for (const entry of toRemove) {
        if (!dryRun) {
          if (fs.existsSync(entry.path)) {
            const stats = fs.statSync(entry.path);
            freed += stats.size;
            fs.unlinkSync(entry.path);
          }
          this.index.entries = this.index.entries.filter(e => e.path !== entry.path);
        }
        removed++;
        console.log(`🗑️  ${dryRun ? 'Would remove' : 'Removed'}: ${entry.name}`);
      }
    }

    if (!dryRun) {
      this.saveIndex();
    }

    console.log(`\n${dryRun ? 'Would remove' : 'Removed'} ${removed} old baselines (${(freed / 1024 / 1024).toFixed(2)} MB)`);
    
    return { removed, freed };
  }

  /**
   * Sync baselines to git
   */
  async syncToGit(message?: string): Promise<void> {
    try {
      const branch = this.getCurrentBranch();
      const commitMsg = message || `Update visual regression baselines for ${branch}`;

      execSync('git add .', { cwd: this.config.baselineDir });
      
      const status = execSync('git status --porcelain', { 
        cwd: this.config.baselineDir,
        encoding: 'utf-8'
      });

      if (status.trim()) {
        execSync(`git commit -m "${commitMsg}"`, { cwd: this.config.baselineDir });
        console.log('✅ Baselines committed to git');
      } else {
        console.log('ℹ️  No changes to commit');
      }
    } catch (error) {
      console.error('❌ Failed to sync to git:', error);
      throw error;
    }
  }

  /**
   * Get index statistics
   */
  getStats(): {
    totalBaselines: number;
    branches: string[];
    viewpoints: string[];
    totalSize: number;
  } {
    const branches = [...new Set(this.index.entries.map(e => e.branch))];
    const viewpoints = [...new Set(this.index.entries.map(e => e.viewpoint))];
    
    let totalSize = 0;
    for (const entry of this.index.entries) {
      if (fs.existsSync(entry.path)) {
        totalSize += fs.statSync(entry.path).size;
      }
    }

    return {
      totalBaselines: this.index.entries.length,
      branches,
      viewpoints,
      totalSize
    };
  }

  /**
   * Export baselines to a zip file
   */
  async exportBaselines(outputPath: string, branch?: string): Promise<void> {
    const archiver = await import('archiver');
    const archive = archiver.default('zip', { zlib: { level: 9 } });
    const output = fs.createWriteStream(outputPath);

    await new Promise<void>((resolve, reject) => {
      output.on('close', () => {
        console.log(`✅ Exported baselines to ${outputPath} (${archive.pointer()} bytes)`);
        resolve();
      });
      
      archive.on('error', reject);
      archive.pipe(output);

      const entries = branch 
        ? this.getBranchBaselines(branch)
        : this.index.entries;

      for (const entry of entries) {
        if (fs.existsSync(entry.path)) {
          archive.file(entry.path, { name: entry.name });
        }
      }

      archive.finalize();
    });
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  const baselineDir = process.argv[3] || './test/baselines';

  const manager = new BaselineManager({ baselineDir });

  switch (command) {
    case 'init':
      manager.init().catch(console.error);
      break;

    case 'update':
      const screenshotsDir = process.argv[4] || './test/screenshots';
      manager.updateBaselines(screenshotsDir).catch(console.error);
      break;

    case 'cleanup':
      const dryRun = process.argv.includes('--dry-run');
      manager.cleanup({ dryRun });
      break;

    case 'stats':
      const stats = manager.getStats();
      console.log('\n📊 Baseline Statistics:');
      console.log(`  Total baselines: ${stats.totalBaselines}`);
      console.log(`  Branches: ${stats.branches.join(', ')}`);
      console.log(`  Viewpoints: ${stats.viewpoints.join(', ')}`);
      console.log(`  Total size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);
      break;

    case 'sync':
      const message = process.argv[4];
      manager.syncToGit(message).catch(console.error);
      break;

    default:
      console.log('Usage: tsx baseline-manager.ts <command> [options]');
      console.log('\nCommands:');
      console.log('  init [baseline-dir]         - Initialize baseline directory');
      console.log('  update [screenshots-dir]    - Update baselines from screenshots');
      console.log('  cleanup [--dry-run]         - Remove old baselines');
      console.log('  stats                       - Show baseline statistics');
      console.log('  sync [message]              - Commit baselines to git');
      process.exit(1);
  }
}
