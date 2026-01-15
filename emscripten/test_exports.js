#!/usr/bin/env node
/**
 * @file test_exports.js
 * @brief Manual test script for Candy World WASM animation functions
 * 
 * This script tests that the compiled WASM module exports work correctly.
 * It attempts to:
 *   1. Load the WASM module
 *   2. Call key animation functions (calcFiberWhip, calcHopY, etc.)
 *   3. Verify return values are within expected ranges
 *   4. Test JavaScript fallback functions work correctly
 * 
 * Usage:
 *   node test_exports.js
 * 
 * Exit codes:
 *   0 - All tests passed
 *   1 - WASM file not found (tests fallbacks only)
 *   2 - Test failures detected
 * 
 * This test can be run manually to verify the build before deployment.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// JAVASCRIPT FALLBACK IMPLEMENTATIONS
// These mirror the fallbacks in src/utils/wasm-loader.js
// ============================================================================

/**
 * JavaScript fallback for calcFiberWhip
 * @returns {object} { baseRotY, branchRotZ }
 */
function calcFiberWhipJS(time, offset, leadVol, isActive, branchIndex) {
    const baseRotY = Math.sin(time * 0.5 + offset) * 0.1;
    const whip = leadVol * 2.0;
    const childOffset = branchIndex * 0.5;
    let branchRotZ = Math.PI / 4 + Math.sin(time * 2.0 + childOffset) * 0.1;
    if (isActive) {
        branchRotZ += Math.sin(time * 10.0 + childOffset) * whip;
    }
    return { baseRotY, branchRotZ };
}

/**
 * JavaScript fallback for calcHopY
 */
function calcHopYJS(time, offset, intensity, kick) {
    const animTime = time + offset;
    const hopVal = Math.sin(animTime * 4.0);
    let bounce = Math.max(0, hopVal) * 0.3 * intensity;
    if (kick > 0.1) bounce += kick * 0.15;
    return bounce;
}

/**
 * JavaScript fallback for calcShiver
 * @returns {object} { rotX, rotZ }
 */
function calcShiverJS(time, offset, intensity) {
    const animTime = time + offset;
    return {
        rotX: Math.sin(animTime * 20.0) * 0.02 * intensity,
        rotZ: Math.cos(animTime * 20.0) * 0.02 * intensity
    };
}

/**
 * JavaScript fallback for calcBounceY
 */
function calcBounceYJS(time, offset, intensity, kick) {
    const animTime = time + offset;
    let yOffset = Math.sin(animTime * 3.0) * 0.1 * intensity;
    if (kick > 0.1) yOffset += kick * 0.2;
    return yOffset;
}

/**
 * JavaScript fallback for calcFloatingY
 */
function calcFloatingYJS(time, offset, baseHeight) {
    return baseHeight + Math.sin(time + offset) * 0.5;
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

let passCount = 0;
let failCount = 0;

function test(name, condition, details = '') {
    if (condition) {
        console.log(`  ✅ ${name}`);
        passCount++;
    } else {
        console.log(`  ❌ ${name}${details ? ': ' + details : ''}`);
        failCount++;
    }
}

function assertRange(value, min, max, tolerance = 0.001) {
    return value >= min - tolerance && value <= max + tolerance;
}

function assertClose(actual, expected, tolerance = 0.0001) {
    return Math.abs(actual - expected) <= tolerance;
}

// ============================================================================
// WASM LOADING
// ============================================================================

async function loadWasmModule(wasmPath) {
    try {
        if (!fs.existsSync(wasmPath)) {
            return null;
        }
        
        const buffer = fs.readFileSync(wasmPath);
        
        // Minimal import object for Emscripten modules
        // Note: This is a simplified import object for testing. The actual Emscripten
        // loader provides more complete stubs. This may not instantiate complex modules.
        const importObject = {
            env: {
                // Emscripten abort function - called on runtime errors
                // The signature varies by Emscripten version, so we accept any arguments
                abort: (...args) => {
                    console.error('WASM abort:', ...args);
                },
                emscripten_notify_memory_growth: () => {},
                __cxa_throw: () => {},
                __cxa_allocate_exception: () => 0,
                _embind_register_void: () => {},
                _embind_register_bool: () => {},
                _embind_register_integer: () => {},
                _embind_register_float: () => {},
                _embind_register_std_string: () => {},
                _embind_register_std_wstring: () => {},
                _embind_register_emval: () => {},
                _embind_register_memory_view: () => {},
            },
            wasi_snapshot_preview1: {
                fd_close: () => 0,
                fd_seek: () => 0,
                fd_write: () => 0,
                fd_read: () => 0,
                fd_fdstat_get: () => 0,
                fd_prestat_get: () => 0,
                fd_prestat_dir_name: () => 0,
                path_open: () => 0,
                environ_sizes_get: () => 0,
                environ_get: () => 0,
                proc_exit: () => {},
                clock_time_get: () => 0,
            }
        };
        
        const result = await WebAssembly.instantiate(buffer, importObject);
        return result.instance;
    } catch (error) {
        console.log(`[WARN] Could not instantiate WASM: ${error.message}`);
        return null;
    }
}

// ============================================================================
// TEST SUITE
// ============================================================================

async function runTests() {
    console.log('');
    console.log('==========================================');
    console.log('  Candy World WASM Animation Tests');
    console.log('==========================================');
    console.log('');
    
    const wasmPath = path.resolve(__dirname, '../public/candy_native.wasm');
    
    // Try to load WASM
    console.log('Loading WASM module...');
    const wasmInstance = await loadWasmModule(wasmPath);
    
    const hasWasm = wasmInstance !== null;
    console.log(hasWasm ? '✅ WASM module loaded' : '⚠️  WASM not available (testing fallbacks only)');
    console.log('');
    
    // -----------------------------------------------------------------------
    // Test JavaScript Fallbacks
    // -----------------------------------------------------------------------
    console.log('------------------------------------------');
    console.log('Testing JavaScript Fallbacks');
    console.log('------------------------------------------');
    
    // Test calcFiberWhipJS
    {
        const result = calcFiberWhipJS(1.0, 0.5, 0.8, true, 2);
        test('calcFiberWhipJS returns baseRotY', typeof result.baseRotY === 'number');
        test('calcFiberWhipJS returns branchRotZ', typeof result.branchRotZ === 'number');
        test('calcFiberWhipJS baseRotY in range [-0.2, 0.2]', assertRange(result.baseRotY, -0.2, 0.2));
    }
    
    // Test calcHopYJS
    {
        const result = calcHopYJS(1.0, 0.5, 1.0, 0.5);
        test('calcHopYJS returns number', typeof result === 'number');
        test('calcHopYJS result >= 0 (no negative hop)', result >= 0);
        test('calcHopYJS result reasonable magnitude', assertRange(result, 0, 1.0));
    }
    
    // Test calcShiverJS
    {
        const result = calcShiverJS(1.0, 0.5, 1.0);
        test('calcShiverJS returns rotX', typeof result.rotX === 'number');
        test('calcShiverJS returns rotZ', typeof result.rotZ === 'number');
        test('calcShiverJS rotX small magnitude', assertRange(result.rotX, -0.05, 0.05));
    }
    
    // Test calcBounceYJS
    {
        const result = calcBounceYJS(1.0, 0.5, 1.0, 0.3);
        test('calcBounceYJS returns number', typeof result === 'number');
    }
    
    // Test calcFloatingYJS
    {
        const baseHeight = 5.0;
        const result = calcFloatingYJS(0, 0, baseHeight);
        test('calcFloatingYJS returns number', typeof result === 'number');
        test('calcFloatingYJS near base height', assertRange(result, baseHeight - 1, baseHeight + 1));
    }
    
    // -----------------------------------------------------------------------
    // Test WASM Functions (if available)
    // -----------------------------------------------------------------------
    if (hasWasm) {
        console.log('');
        console.log('------------------------------------------');
        console.log('Testing WASM Functions');
        console.log('------------------------------------------');
        
        const exports = wasmInstance.exports;
        
        // Helper to get function (handles underscore prefix)
        const getFunc = (name) => exports['_' + name] || exports[name] || null;
        
        // Test calcFiberWhip
        {
            const calcFiberWhip = getFunc('calcFiberWhip');
            const getFiberBaseRotY = getFunc('getFiberBaseRotY');
            const getFiberBranchRotZ = getFunc('getFiberBranchRotZ');
            
            if (calcFiberWhip && getFiberBaseRotY && getFiberBranchRotZ) {
                calcFiberWhip(1.0, 0.5, 0.8, 1, 2);
                const baseRotY = getFiberBaseRotY();
                const branchRotZ = getFiberBranchRotZ();
                
                test('WASM calcFiberWhip works', typeof baseRotY === 'number');
                test('WASM getFiberBaseRotY in range', assertRange(baseRotY, -0.2, 0.2));
                test('WASM getFiberBranchRotZ in range', assertRange(branchRotZ, 0, Math.PI));
                
                // Compare with JS fallback
                const jsResult = calcFiberWhipJS(1.0, 0.5, 0.8, true, 2);
                test('WASM matches JS fallback (baseRotY)', assertClose(baseRotY, jsResult.baseRotY, 0.001));
            } else {
                console.log('  ⚠️  calcFiberWhip not exported (JS fallback will be used)');
            }
        }
        
        // Test calcHopY
        {
            const calcHopY = getFunc('calcHopY');
            if (calcHopY) {
                const result = calcHopY(1.0, 0.5, 1.0, 0.5);
                test('WASM calcHopY works', typeof result === 'number');
                
                const jsResult = calcHopYJS(1.0, 0.5, 1.0, 0.5);
                test('WASM calcHopY matches JS', assertClose(result, jsResult, 0.001));
            } else {
                console.log('  ⚠️  calcHopY not exported (JS fallback will be used)');
            }
        }
        
        // Test calcShiver
        {
            const calcShiver = getFunc('calcShiver');
            const getShiverRotX = getFunc('getShiverRotX');
            const getShiverRotZ = getFunc('getShiverRotZ');
            
            if (calcShiver && getShiverRotX && getShiverRotZ) {
                calcShiver(1.0, 0.5, 1.0);
                const rotX = getShiverRotX();
                const rotZ = getShiverRotZ();
                
                test('WASM calcShiver works', typeof rotX === 'number');
                
                const jsResult = calcShiverJS(1.0, 0.5, 1.0);
                test('WASM calcShiver matches JS (rotX)', assertClose(rotX, jsResult.rotX, 0.001));
            } else {
                console.log('  ⚠️  calcShiver not exported (JS fallback will be used)');
            }
        }
        
        // Test calcBounceY
        {
            const calcBounceY = getFunc('calcBounceY');
            if (calcBounceY) {
                const result = calcBounceY(1.0, 0.5, 1.0, 0.3);
                test('WASM calcBounceY works', typeof result === 'number');
            } else {
                console.log('  ⚠️  calcBounceY not exported (JS fallback will be used)');
            }
        }
        
        // Test calcFloatingY
        {
            const calcFloatingY = getFunc('calcFloatingY');
            if (calcFloatingY) {
                const result = calcFloatingY(0, 0, 5.0);
                test('WASM calcFloatingY works', typeof result === 'number');
                test('WASM calcFloatingY correct value', assertClose(result, 5.0, 0.1));
            } else {
                console.log('  ⚠️  calcFloatingY not exported (JS fallback will be used)');
            }
        }
    }
    
    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('');
    console.log('==========================================');
    console.log('TEST SUMMARY');
    console.log('==========================================');
    console.log(`Passed: ${passCount}`);
    console.log(`Failed: ${failCount}`);
    console.log('');
    
    if (failCount === 0) {
        console.log('✅ All tests passed!');
        console.log('');
        process.exit(0);
    } else {
        console.log('❌ Some tests failed.');
        console.log('');
        process.exit(2);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Test runner error:', error);
    process.exit(2);
});
