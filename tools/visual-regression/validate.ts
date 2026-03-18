#!/usr/bin/env node
/**
 * Validate visual regression testing setup
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

function check(name: string, condition: boolean, message?: string): boolean {
  if (condition) {
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    return true;
  } else {
    console.log(`${colors.red}✗${colors.reset} ${name}${message ? `: ${message}` : ''}`);
    return false;
  }
}

async function validate() {
  console.log('🎮 Candy World Visual Regression Validation\n');
  
  const rootDir = path.join(__dirname, '..', '..', '..');
  const vrDir = path.join(rootDir, 'tools', 'visual-regression');
  
  let passed = 0;
  let failed = 0;
  
  // Check directory structure
  console.log('📁 Directory Structure:');
  if (check('visual-regression directory exists', fs.existsSync(vrDir))) passed++; else failed++;
  if (check('src directory exists', fs.existsSync(path.join(vrDir, 'src')))) passed++; else failed++;
  if (check('test directory exists', fs.existsSync(path.join(vrDir, 'test')))) passed++; else failed++;
  
  // Check source files
  console.log('\n📄 Source Files:');
  const files = [
    'screenshot-capture.ts',
    'screenshot-compare.ts',
    'baseline-manager.ts',
    'performance-screenshot.ts',
    'report-generator.ts',
    'utils.ts'
  ];
  
  for (const file of files) {
    const exists = fs.existsSync(path.join(vrDir, 'src', file));
    if (check(file, exists)) passed++; else failed++;
  }
  
  // Check main files
  console.log('\n🔧 Main Files:');
  if (check('cli.ts exists', fs.existsSync(path.join(vrDir, 'cli.ts')))) passed++; else failed++;
  if (check('index.ts exists', fs.existsSync(path.join(vrDir, 'index.ts')))) passed++; else failed++;
  if (check('package.json exists', fs.existsSync(path.join(vrDir, 'package.json')))) passed++; else failed++;
  if (check('README.md exists', fs.existsSync(path.join(vrDir, 'README.md')))) passed++; else failed++;
  
  // Check package.json scripts
  console.log('\n📦 Package Configuration:');
  const pkgPath = path.join(vrDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const hasScripts = ['capture', 'compare', 'baseline', 'performance', 'report', 'test', 'test:visual']
      .every(script => pkg.scripts?.[script]);
    if (check('All required scripts defined', hasScripts)) passed++; else failed++;
  }
  
  // Check root package.json
  console.log('\n🌳 Root Package:');
  const rootPkgPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
    if (check('test:visual script in root', rootPkg.scripts?.['test:visual']?.includes('visual-regression'))) passed++; else failed++;
  }
  
  // Check GitHub workflow
  console.log('\n🔄 CI/CD:');
  const workflowPath = path.join(rootDir, '.github', 'workflows', 'visual-regression.yml');
  if (check('GitHub Actions workflow exists', fs.existsSync(workflowPath))) passed++; else failed++;
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${colors.green}${passed} passed${colors.reset}, ${colors.red}${failed} failed${colors.reset}`);
  
  if (failed === 0) {
    console.log(`\n${colors.green}✅ Visual regression system is properly configured!${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`\n${colors.red}❌ Some validation checks failed.${colors.reset}`);
    process.exit(1);
  }
}

validate();
