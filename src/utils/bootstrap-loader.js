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
export function startBootstrap(emscriptenInstance) {
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

/**
 * Get the current bootstrap progress
 * @param {Object} emscriptenInstance - The loaded Emscripten module
 * @returns {number} Progress percentage (0-100)
 */
export function getBootstrapProgress(emscriptenInstance) {
    if (!emscriptenInstance || !bootstrapActive) {
        return 0;
    }

    const progressFn = getNativeFunc('getBootstrapProgress', emscriptenInstance);
    if (!progressFn) {
        return 0;
    }

    try {
        return progressFn();
    } catch (error) {
        console.error('[Bootstrap] Failed to get progress:', error);
        return 0;
    }
}

/**
 * Check if bootstrap is complete
 * @param {Object} emscriptenInstance - The loaded Emscripten module
 * @returns {boolean} True if bootstrap is complete
 */
export function isBootstrapComplete(emscriptenInstance) {
    if (!emscriptenInstance || !bootstrapActive) {
        return false;
    }

    const completeFn = getNativeFunc('isBootstrapComplete', emscriptenInstance);
    if (!completeFn) {
        return false;
    }

    try {
        const result = completeFn();
        if (result === 1) {
            const duration = performance.now() - bootstrapStartTime;
            console.log(`[Bootstrap] Terrain pre-computation complete (${duration.toFixed(0)}ms)`);
            bootstrapActive = false;
            return true;
        }
        return false;
    } catch (error) {
        console.error('[Bootstrap] Failed to check completion:', error);
        return false;
    }
}

/**
 * Poll bootstrap progress and update loading UI
 * @param {Object} emscriptenInstance - The loaded Emscripten module
 * @param {Function} onProgress - Callback for progress updates (progress: number)
 * @param {Function} onComplete - Callback when bootstrap completes
 * @param {number} pollInterval - Polling interval in ms (default: 50ms)
 * @returns {Function} Stop function to cancel polling
 */
export function pollBootstrapProgress(emscriptenInstance, onProgress, onComplete, pollInterval = 50) {
    if (!emscriptenInstance || !bootstrapActive) {
        return () => {};
    }

    let lastProgress = 0;
    let intervalId = null;
    
    const cleanup = () => {
        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }
    };
    
    intervalId = setInterval(() => {
        try {
            const progress = getBootstrapProgress(emscriptenInstance);
            
            if (progress !== lastProgress) {
                lastProgress = progress;
                if (onProgress) {
                    try {
                        onProgress(progress);
                    } catch (e) {
                        console.error('[Bootstrap] Progress callback error:', e);
                    }
                }
            }

            if (isBootstrapComplete(emscriptenInstance)) {
                cleanup();
                if (onComplete) {
                    try {
                        onComplete();
                    } catch (e) {
                        console.error('[Bootstrap] Complete callback error:', e);
                    }
                }
            }
        } catch (error) {
            console.error('[Bootstrap] Polling error:', error);
            cleanup();
        }
    }, pollInterval);

    // Return stop function
    return cleanup;
}

/**
 * Reset bootstrap state (useful for testing)
 * @param {Object} emscriptenInstance - The loaded Emscripten module
 */
export function resetBootstrap(emscriptenInstance) {
    if (!emscriptenInstance) {
        return;
    }

    const resetFn = getNativeFunc('resetBootstrap', emscriptenInstance);
    if (resetFn) {
        try {
            resetFn();
            bootstrapActive = false;
            bootstrapStartTime = 0;
            console.log('[Bootstrap] State reset');
        } catch (error) {
            console.error('[Bootstrap] Failed to reset:', error);
        }
    }
}

/**
 * Get pre-computed height at a specific point
 * This is faster than recalculating terrain noise for cached regions
 * @param {Object} emscriptenInstance - The loaded Emscripten module
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {number} Terrain height at (x, z)
 */
export function getBootstrapHeight(emscriptenInstance, x, z) {
    if (!emscriptenInstance) {
        return 0;
    }

    const heightFn = getNativeFunc('getBootstrapHeight', emscriptenInstance);
    if (!heightFn) {
        return 0;
    }

    try {
        return heightFn(x, z);
    } catch (error) {
        console.error('[Bootstrap] Failed to get height:', error);
        return 0;
    }
}

/**
 * Integrate bootstrap loader with loading UI
 * Shows progress updates in the loading overlay
 * @param {Object} emscriptenInstance - The loaded Emscripten module
 * @returns {Promise<void>} Resolves when bootstrap completes
 */
export function integrateWithLoadingUI(emscriptenInstance) {
    return new Promise((resolve) => {
        if (!startBootstrap(emscriptenInstance)) {
            // Bootstrap failed to start, resolve immediately
            resolve();
            return;
        }

        // Update loading status
        if (window.setLoadingStatus) {
            window.setLoadingStatus('Pre-computing terrain (0%)...');
        }

        // Poll progress
        pollBootstrapProgress(
            emscriptenInstance,
            (progress) => {
                // Update UI with progress
                if (window.setLoadingStatus) {
                    window.setLoadingStatus(`Pre-computing terrain (${progress}%)...`);
                }
            },
            () => {
                // Complete
                if (window.setLoadingStatus) {
                    window.setLoadingStatus('Terrain ready!');
                }
                resolve();
            }
        );
    });
}
