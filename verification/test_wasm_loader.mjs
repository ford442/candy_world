/**
 * Verification script for WASM Loader exports
 * Run with: node verification/test_wasm_loader.mjs
 */

import assert from 'assert';

// 1. Mock Browser Environment (Required before import)
// This prevents wasm-loader.js from crashing when it accesses window/document
global.window = {
    setLoadingStatus: () => {},
    NativeWebAssembly: undefined,
    location: { href: 'http://localhost' }
};

global.document = {
    getElementById: () => ({
        style: {},
        textContent: '',
        disabled: false
    })
};

global.fetch = async () => ({ ok: false, status: 404 }); // Fail fetches gracefully
global.SharedArrayBuffer = ArrayBuffer; // Mock SAB support

console.log('🔄 Importing wasm-loader.js...');

try {
    // Dynamic import to ensure mocks apply first
    const loader = await import('../src/utils/wasm-loader.js');

    // 2. Verify Export Existence
    if (typeof loader.calcArpeggioStep !== 'function') {
        throw new Error('❌ calcArpeggioStep is NOT exported!');
    }
    console.log('✅ calcArpeggioStep export found.');

    // 3. Verify Functionality (JS Fallback)
    // Params: currentUnfurl, currentTarget, lastTrigger, arpeggioActive, noteTrigger, maxSteps
    console.log('🔄 Testing logic...');
    
    // Case A: Trigger Active (Should increment target)
    const result1 = loader.calcArpeggioStep(0, 0, false, true, true, 12);
    assert.strictEqual(result1.targetStep, 1, 'Target should increment on trigger');
    console.log('   - Trigger logic passed');

    // Case B: Inactive (Should reset to 0)
    const result2 = loader.calcArpeggioStep(5, 5, false, false, false, 12);
    assert.strictEqual(result2.targetStep, 0, 'Target should reset when inactive');
    console.log('   - Inactive logic passed');

    console.log('\n✨ Verification Successful: Export is working correctly.');
    process.exit(0);

} catch (error) {
    console.error('\n❌ Verification Failed:', error.message);
    console.error(error);
    process.exit(1);
}
