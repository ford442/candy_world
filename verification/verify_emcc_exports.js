#!/usr/bin/env node
// verification/verify_emcc_exports.js
// Simple node script to check that public/candy_native.wasm exports required symbols
import fs from 'fs';

import { fileURLToPath } from 'url';
const wasmPath = fileURLToPath(new URL('../public/candy_native.wasm', import.meta.url));
const expected = [
  'calcFiberWhip',
  'getFiberBaseRotY',
  'getFiberBranchRotZ',
  'initPhysics',
  'updatePhysicsCPP'
];

function main() {
    if (!fs.existsSync(wasmPath)) {
        console.error('❌ Wasm not found:', wasmPath);
        process.exit(1);
    }
    try {
        const bytes = fs.readFileSync(wasmPath);
        const exports = WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(e => e.name);
        const missing = expected.filter(n => !exports.includes(n));
        if (missing.length) {
            console.error('❌ Missing exports:', missing.join(', '));
            console.error('Found exports sample:', exports.slice(0, 50).join(', '));
            process.exit(2);
        }
        console.log('✅ All required EMCC exports present');
    } catch (e) {
        console.error('❌ Failed to inspect wasm:', e);
        process.exit(1);
    }
}

main();