#!/usr/bin/env node
/**
 * TSL Validation Test
 * 
 * This script performs static analysis on the codebase to detect
 * potential TSL node type mismatches before runtime.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('🔍 Running TSL Validation Tests...\n');

let errorCount = 0;
let warningCount = 0;

// Pattern 1: Check for vec3(u...) or color(u...) where u... is likely a uniform
const uniformWrapPattern = /(?:vec3|color|vec4)\s*\(\s*u[A-Z]\w+\s*\)/g;

// Pattern 2: Check for uniform() calls with TSL nodes instead of THREE objects
const uniformTSLPattern = /uniform\s*\(\s*(?:vec3|color|vec4)\s*\(/g;

function walkDir(dir, callback) {
    const files = readdirSync(dir);
    
    for (const file of files) {
        const filePath = join(dir, file);
        const stat = statSync(filePath);
        
        if (stat.isDirectory()) {
            if (!file.startsWith('.') && file !== 'node_modules' && file !== 'dist') {
                walkDir(filePath, callback);
            }
        } else if (file.endsWith('.js') || file.endsWith('.ts')) {
            callback(filePath);
        }
    }
}

function analyzeFile(filePath) {
    const content = readFileSync(filePath, 'utf-8');
    const relativePath = filePath.replace(rootDir, '');
    const lines = content.split('\n');
    
    let fileErrors = [];
    let fileWarnings = [];
    
    // Check for wrapped uniforms
    const uniformWraps = [...content.matchAll(uniformWrapPattern)];
    if (uniformWraps.length > 0) {
        uniformWraps.forEach(match => {
            const lineNum = content.substring(0, match.index).split('\n').length;
            const line = lines[lineNum - 1];
            
            // Skip if it's in a comment
            if (line.trim().startsWith('//') || line.includes('// FIX:')) {
                return;
            }
            
            fileWarnings.push({
                line: lineNum,
                code: match[0],
                message: 'Potential uniform wrapping detected. Verify this is correct.'
            });
        });
    }
    
    // Check for TSL nodes in uniform() calls
    const uniformTSL = [...content.matchAll(uniformTSLPattern)];
    if (uniformTSL.length > 0) {
        uniformTSL.forEach(match => {
            const lineNum = content.substring(0, match.index).split('\n').length;
            const line = lines[lineNum - 1];
            
            // Skip if it's in a comment
            if (line.trim().startsWith('//')) {
                return;
            }
            
            fileErrors.push({
                line: lineNum,
                code: match[0],
                message: 'uniform() should receive THREE.js objects, not TSL nodes!'
            });
        });
    }
    
    if (fileErrors.length > 0) {
        console.log(`❌ ${relativePath}`);
        fileErrors.forEach(err => {
            console.log(`   Line ${err.line}: ${err.message}`);
            console.log(`   Code: ${err.code}`);
        });
        errorCount += fileErrors.length;
    }
    
    if (fileWarnings.length > 0) {
        console.log(`⚠️  ${relativePath}`);
        fileWarnings.forEach(warn => {
            console.log(`   Line ${warn.line}: ${warn.message}`);
            console.log(`   Code: ${warn.code}`);
        });
        warningCount += fileWarnings.length;
    }
}

// Find all relevant files
const allFiles = [];
walkDir(join(rootDir, 'src'), (file) => allFiles.push(file));
const mainJs = join(rootDir, 'main.js');
const mainTs = join(rootDir, 'main.ts');
try { statSync(mainJs); allFiles.push(mainJs); } catch (e) {}
try { statSync(mainTs); allFiles.push(mainTs); } catch (e) {}

console.log(`Analyzing ${allFiles.length} files...\n`);

for (const file of allFiles) {
    analyzeFile(file);
}

console.log('\n' + '='.repeat(50));
console.log('📊 Summary:');
console.log(`   Errors: ${errorCount}`);
console.log(`   Warnings: ${warningCount}`);

if (errorCount === 0) {
    console.log('\n✅ No critical TSL errors detected!');
    if (warningCount > 0) {
        console.log('⚠️  Some warnings found - please review them.');
    }
    process.exit(0);
} else {
    console.log('\n❌ Critical errors detected! Please fix them.');
    process.exit(1);
}
