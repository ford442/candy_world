// src/utils/bootstrap-loader.js
// JavaScript wrapper for the Emscripten pthread bootstrap loader
// Manages terrain pre-computation and loading UI integration

/**
 * Bootstrap Loader - Pre-warms terrain generation using pthread workers
 * 
 * This module provides a JavaScript interface to the C++ pthread bootstrap
 * loader, which pre-computes terrain heightmaps for common spawn areas to
 * improve initial world generation performance.
 */

let bootstrapActive = false;
let bootstrapStartTime = 0;

/**
 * Get the native bootstrap function from Emscripten module
 * @param {string} name - Function name (without underscore prefix)
 * @returns {Function|null}
 */
function getNativeFunc(name, emscriptenInstance) {
    if (!emscriptenInstance) return null;
    return emscriptenInstance['_' + name] || null;
}

/**
 * Start the bootstrap initialization process
 * @param {Object} emscriptenInstance - The loaded Emscripten module
 * @returns {boolean} True if bootstrap started successfully
 */
function startBootstrap(emscriptenInstance) {
    if (!emscriptenInstance) {
        console.warn('[Bootstrap] Emscripten module not available');
        return false;
    }

    const startFn = getNativeFunc('startBootstrapInit', emscriptenInstance);
    if (!startFn) {
        console.warn('[Bootstrap] startBootstrapInit not found in WASM exports');
        return false;
    }

    try {
        startFn();
        bootstrapActive = true;
        bootstrapStartTime = performance.now();
        console.log('[Bootstrap] Terrain pre-computation started');
        return true;
    } catch (error) {
        console.error('[Bootstrap] Failed to start:', error);
        return false;
    }
}

export { startBootstrap };
//# sourceMappingURL=bootstrap-loader-CnH2pKW9.js.map
