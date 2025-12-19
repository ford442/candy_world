// Provide a minimal document stub for node tests
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { getElementById: (id) => ({ disabled: false, textContent: '', style: {} }) };
}

const wasm = await import('../src/utils/wasm-loader.js');

(async () => {
  try {
    console.log('Testing wasm-loader exports...');

    const initResult = await wasm.initWasm();
    console.log('initWasm returned:', initResult);

    // Ensure basic functions are callable and return numbers
    const h = wasm.getGroundHeight(0, 0);
    if (typeof h !== 'number' || Number.isNaN(h)) throw new Error('getGroundHeight returned invalid');
    console.log('getGroundHeight(0,0) =', h);

    const freq = wasm.freqToHue(440);
    if (typeof freq !== 'number') throw new Error('freqToHue returned invalid');
    console.log('freqToHue(440) =', freq);

    const lerp = wasm.lerp(0, 10, 0.5);
    if (lerp !== 5) throw new Error('lerp returned wrong value');
    console.log('lerp(0,10,0.5) =', lerp);

    // Try batchAnimationCalc (should return Float32Array or null)
    const anim = wasm.batchAnimationCalc ? wasm.batchAnimationCalc(0, 1.0, 0, 1) : null;
    console.log('batchAnimationCalc result:', anim ? 'array' : 'null/fallback');

    console.log('WASM loader smoke test passed');
    process.exit(0);
  } catch (err) {
    console.error('WASM loader test failed:', err);
    process.exit(2);
  }
})();
