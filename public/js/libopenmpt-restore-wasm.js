// libopenmpt.js is a wasm2js build that replaces window.WebAssembly with a
// fake polyfill. Restore the real native WebAssembly so the app's own WASM
// modules (candy_physics.wasm) can instantiate correctly.
window.WebAssembly = window.NativeWebAssembly || window.WebAssembly;
