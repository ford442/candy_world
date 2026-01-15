#!/usr/bin/env node
/**
 * @file verify_emcc_exports.js
 * @brief Verifies that required EMCC WASM exports are present
 * 
 * This script checks that the compiled candy_native.wasm contains the expected
 * function exports. It handles both underscore-prefixed (_funcName) and 
 * non-prefixed (funcName) export names.
 * 
 * NOTE: If the WASM file is missing, the application will still work using
 * JavaScript fallbacks defined in src/utils/wasm-loader.js. This verification
 * is for performance optimization, not correctness.
 * 
 * Usage:
 *   npm run verify:emcc
 *   node verification/verify_emcc_exports.js
 * 
 * Exit codes:
 *   0 - All required exports present, or WASM file not found (fallbacks work)
 *   2 - Required exports missing from existing WASM (may indicate build issue)
 */
import fs from 'fs';

import { fileURLToPath } from 'url';
const wasmPath = fileURLToPath(new URL('../public/candy_native.wasm', import.meta.url));

// Required exports for key animation functions
// These are checked with and without underscore prefix
const expected = [
  'calcFiberWhip',
  'getFiberBaseRotY',
  'getFiberBranchRotZ',
  'initPhysics',
  'updatePhysicsCPP'
];

function main() {
    if (!fs.existsSync(wasmPath)) {
        console.log('⚠️  WASM file not found:', wasmPath);
        console.log('   This is OK - the application will use JavaScript fallbacks.');
        console.log('   To build native WASM: npm run build:emcc');
        // Exit with 0 since fallbacks will work - this is not a failure
        process.exit(0);
    }
    try {
        const bytes = fs.readFileSync(wasmPath);
        const exports = WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(e => e.name);
        
        // Check for each expected export (with or without underscore prefix)
        const missing = expected.filter(n => {
            const hasPlain = exports.includes(n);
            const hasUnderscore = exports.includes('_' + n);
            return !hasPlain && !hasUnderscore;
        });
        
        if (missing.length) {
            console.error('❌ Missing exports:', missing.join(', '));
            console.error('   These functions will use JavaScript fallbacks.');
            console.error('');
            console.error('Found exports sample:', exports.slice(0, 30).join(', '));
            process.exit(2);
        }
        console.log('✅ All required EMCC exports present');
    } catch (e) {
        console.error('❌ Failed to inspect wasm:', e);
        process.exit(1);
    }
}

main();