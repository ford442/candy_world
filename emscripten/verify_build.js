#!/usr/bin/env node
/**
 * @file verify_build.js
 * @brief Post-build verification script for Candy World WASM module
 * 
 * This script inspects the compiled WASM file and verifies which animation
 * functions are exported. It produces a summary showing:
 *   - Successfully exported functions
 *   - Missing functions (will use JS fallback)
 *   - Overall build health status
 * 
 * Usage:
 *   node verify_build.js [path/to/candy_native.wasm]
 * 
 * Called automatically by build.sh after successful compilation.
 * 
 * Exit codes:
 *   0 - Verification complete (even if some functions are missing)
 *   1 - WASM file not found or unreadable
 *   2 - Critical error during verification
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Expected exports: emscripten/exports.txt (EXPORTED_FUNCTIONS, which
// verify:emcc:manifest proves is the whole C++ ABI), grouped by the source tag
// build.sh gives each name. A hand-kept copy here drifted from the real list.
function loadExpectedExports() {
    const listed = fs
        .readFileSync(path.resolve(__dirname, 'exports.txt'), 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/^_/, ''))
        .filter((l) => l && !['main', 'malloc', 'free'].includes(l));
    const tags = new Map();
    const buildSh = fs.readFileSync(path.resolve(__dirname, 'build.sh'), 'utf8');
    for (const m of buildSh.matchAll(/\["(\w+)"\]="(\w+)"/g)) tags.set(m[1], m[2]);
    const byTag = {};
    for (const name of listed) (byTag[tags.get(name) ?? 'other'] ??= []).push(name);
    return byTag;
}

const EXPECTED_EXPORTS = loadExpectedExports();

/**
 * Read and parse WASM exports from a compiled module
 * @param {string} wasmPath - Path to the WASM file
 * @returns {string[]} Array of export names
 */
function getWasmExports(wasmPath) {
    try {
        const buffer = fs.readFileSync(wasmPath);
        const module = new WebAssembly.Module(buffer);
        const exports = WebAssembly.Module.exports(module);
        return exports.map(e => e.name);
    } catch (error) {
        console.error(`[ERROR] Failed to read WASM exports: ${error.message}`);
        return null;
    }
}

/**
 * Normalize export name (remove leading underscore if present)
 * @param {string} name - Export name
 * @returns {string} Normalized name
 */
function normalizeExportName(name) {
    return name.startsWith('_') ? name.slice(1) : name;
}

/**
 * Main verification function
 */
function main() {
    console.log('');
    console.log('==========================================');
    console.log('  Candy World WASM Export Verification');
    console.log('==========================================');
    console.log('');
    
    // Get WASM file path from command line or use default
    let wasmPath = process.argv.slice(2).find(arg => !arg.startsWith("--"));
    if (!wasmPath) {
        wasmPath = path.resolve(__dirname, '../public/candy_native.wasm');
    }
    
    // Check if file exists
    if (!fs.existsSync(wasmPath)) {
        console.error(`[ERROR] WASM file not found: ${wasmPath}`);
        console.error('');
        console.error('Build the WASM module first with: npm run build:emcc');
        process.exit(1);
    }
    
    // Get file info
    const stats = fs.statSync(wasmPath);
    console.log(`File: ${path.basename(wasmPath)}`);
    console.log(`Size: ${(stats.size / 1024).toFixed(1)} KB`);
    console.log('');
    
    // Get exports
    const exports = getWasmExports(wasmPath);
    if (!exports) {
        process.exit(2);
    }
    
    // Normalize export names (handle both _funcName and funcName)
    const exportSet = new Set(exports.map(normalizeExportName));
    
    // Track results by category
    const results = {
        exported: [],
        missing: [],
        byCategory: {}
    };
    
    // Check each expected function
    for (const [category, functions] of Object.entries(EXPECTED_EXPORTS)) {
        results.byCategory[category] = { found: [], missing: [] };
        
        for (const func of functions) {
            const hasExport = exportSet.has(func);
            
            if (hasExport) {
                results.exported.push(func);
                results.byCategory[category].found.push(func);
            } else {
                results.missing.push(func);
                results.byCategory[category].missing.push(func);
            }
        }
    }
    
    // Print results by category
    for (const [category, { found, missing }] of Object.entries(results.byCategory)) {
        const icon = missing.length === 0 ? '✅' : (found.length === 0 ? '❌' : '⚠️');
        console.log(`${icon} ${category.toUpperCase()}: ${found.length}/${found.length + missing.length} exported`);
        
        if (missing.length > 0 && missing.length <= 5) {
            console.log(`   Missing: ${missing.join(', ')}`);
        } else if (missing.length > 5) {
            console.log(`   Missing: ${missing.slice(0, 3).join(', ')} and ${missing.length - 3} more...`);
        }
    }
    
    // Print summary
    console.log('');
    console.log('------------------------------------------');
    console.log('SUMMARY');
    console.log('------------------------------------------');
    
    const totalExpected = results.exported.length + results.missing.length;
    const percentage = ((results.exported.length / totalExpected) * 100).toFixed(1);
    
    console.log(`Exported: ${results.exported.length}/${totalExpected} (${percentage}%)`);
    
    if (results.missing.length === 0) {
        console.log(`Missing: none`);
        console.log('');
        console.log('✅ Every exports.txt function is exported!');
    } else {
        console.log(`Missing: ${results.missing.length} functions`);
        console.log('');
        console.log('⚠️  Some functions are missing from WASM exports.');
        console.log('   The JavaScript fallbacks will be used for these functions.');
        console.log('   This is safe but may have slightly lower performance.');
    }
    
    // List key functions for quick reference
    console.log('');
    console.log('------------------------------------------');
    console.log('KEY FUNCTION STATUS');
    console.log('------------------------------------------');
    
    const keyFunctions = [
        'getUnifiedGroundHeight',
        'batchGroundHeight_simd',
        'updatePhysicsCPP',
        'updateCpuParticlesWASM',
        'ecsInit'
    ];
    
    for (const func of keyFunctions) {
        const status = exportSet.has(func) ? '✅' : '❌';
        console.log(`${status} ${func}`);
    }
    
    console.log('');
    console.log('==========================================');
    console.log('');
    
    // Always exit successfully - missing exports are handled by JS fallbacks
    if (process.argv.includes("--strict") && results.missing.length > 0) {
        console.error(`[ERROR] Strict mode enabled and ${results.missing.length} exports are missing!`);
        process.exit(1);
    }
    process.exit(0);
}

main();
