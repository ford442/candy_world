#!/usr/bin/env node
// verification/verify_emcc_exports.js
// Simple node script to check that public/candy_native.wasm exports required symbols
const fs = require('fs');

const wasmPath = `${__dirname}/../public/candy_native.wasm`;
const expected = [
  // Speaker exports removed; no longer required.
];

function main() {
  if (!fs.existsSync(wasmPath)) {
    console.log('candy_native.wasm not found, skipping verification');
    process.exit(0);
  }
  try {
    const bytes = fs.readFileSync(wasmPath);
    const mod = new WebAssembly.Module(bytes);
    const ex = WebAssembly.Module.exports(mod).map(e => e.name);
    console.log('[verify_emcc_exports] exports:', ex);
    const missing = expected.filter(x => !ex.includes(x));
    if (missing.length) {
      console.warn('[verify_emcc_exports] Missing expected exports:', missing);
      process.exit(2);
    }
    console.log('[verify_emcc_exports] All expected exports present');
    process.exit(0);
  } catch (e) {
    console.warn('[verify_emcc_exports] Failed to inspect wasm exports:', e);
    process.exit(3);
  }
}

main();