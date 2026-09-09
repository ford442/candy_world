// Use a Promise to notify the app when libopenmpt is ready.
// libopenmpt.js is a wasm2js build — all WASM code is compiled to asm.js,
// so no separate .wasm file is fetched. We intercept instantiateWasm to
// prevent the fallback fetch(undefined) → 404 path from ever running.
window.NativeWebAssembly = window.WebAssembly;

window.libopenmptReady = new Promise(resolve => {
    window.libopenmpt = {
        // Limit memory to 32MB to prevent "Array buffer allocation failed"
        INITIAL_MEMORY: 33554432,

        // wasm2js: short-circuit the WASM instantiation path so no external
        // fetch is attempted. The asmFunc (asm.js) takes over automatically.
        instantiateWasm: function(imports, successCallback) {
            return {};
        },

        onRuntimeInitialized: function () {
            console.log('[libopenmpt] Runtime initialized (wasm2js mode).');
            resolve(this);
        }
    };
});
