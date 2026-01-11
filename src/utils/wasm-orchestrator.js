// WASM-First GPU Pipeline Orchestrator
// Updated for Emscripten Pthreads Support

import { checkWasmFileExists, inspectWasmExports, patchWasmInstantiateAliases } from './wasm-utils.js';

export const LOADING_PHASES = {
    WASM_INIT: 0,
    ASSET_DECODE: 1,
    GPU_UPLOAD: 2,
    PIPELINE_WARMUP: 3,
    READY: 4
};

export const PHASE_STATUS = {
    PENDING: 0,
    IN_PROGRESS: 1,
    COMPLETE: 2,
    ERROR: -1
};

// --- Shared Memory Utilities (Keep your existing code here) ---
let syncBuffer = null;
let syncView = null;

export function getSharedBuffer() {
    return syncBuffer;
}

export function isSharedMemoryAvailable() {
    try {
        if (typeof SharedArrayBuffer === 'undefined') return false;
        const test = new SharedArrayBuffer(4);
        const view = new Int32Array(test);
        Atomics.store(view, 0, 1);
        return Atomics.load(view, 0) === 1;
    } catch (e) {
        return false;
    }
}

export function initSharedBuffer() {
    if (syncBuffer !== null) return true;
    if (!isSharedMemoryAvailable()) return false;
    try {
        syncBuffer = new SharedArrayBuffer(5 * Int32Array.BYTES_PER_ELEMENT);
        syncView = new Int32Array(syncBuffer);
        for (let i = 0; i < 5; i++) Atomics.store(syncView, i, PHASE_STATUS.PENDING);
        console.log('[WASMOrchestrator] Shared coordination buffer initialized');
        return true;
    } catch (e) {
        return false;
    }
}

export function signalPhaseComplete(phase) {
    if (!syncView) return;
    Atomics.store(syncView, phase, PHASE_STATUS.COMPLETE);
    Atomics.notify(syncView, phase);
    console.log(`[WASMOrchestrator] Phase ${phase} complete`);
}

export function signalPhaseStart(phase) {
    if (!syncView) return;
    Atomics.store(syncView, phase, PHASE_STATUS.IN_PROGRESS);
}

// --- HYBRID LOADER (The Fix) ---

/**
 * Parallel WASM Module Loader
 * - ASC: Loaded Manually (Standalone)
 * - EMCC: Loaded via Generated Loader (Pthreads)
 */
export async function parallelWasmLoad(options = {}) {
    const {
        onProgress = () => {},
        ascWasmUrl = './candy_physics.wasm',
        cacheVersion = ''
    } = options;

    const buildUrl = (baseUrl) => cacheVersion ? `${baseUrl}?v=${cacheVersion}` : baseUrl;

    initSharedBuffer();
    
    onProgress(LOADING_PHASES.WASM_INIT, 'Initializing WASM modules...');
    signalPhaseStart(LOADING_PHASES.WASM_INIT);

    const results = { asc: null, emcc: null };

    // ---------------------------------------------------------
    // 1. Start Loading ASC (Manual / Standalone)
    // ---------------------------------------------------------
    const ascPromise = (async () => {
        try {
            // Minimal WASI stubs for AssemblyScript
            const wasiStubs = {
                fd_write: () => 0,
                abort: () => {},
                clock_time_get: () => performance.now()
            };

            const importObject = {
                env: {
                    abort: () => console.error("ASC Abort"),
                    seed: () => Math.random()
                },
                wasi_snapshot_preview1: wasiStubs
            };

            // Try streaming instantiation first for faster compilation
            let instance;
            try {
                const result = await WebAssembly.instantiateStreaming(
                    fetch(buildUrl(ascWasmUrl)),
                    importObject
                );
                instance = result.instance;
                console.log('[WASMOrchestrator] ASC module compiled (streaming)');
            } catch (streamError) {
                console.log('[WASMOrchestrator] Streaming failed, using fallback:', streamError);
                // Fallback to traditional method
                const response = await fetch(buildUrl(ascWasmUrl));
                if (!response.ok) return null;
                const bytes = await response.arrayBuffer();
                const result = await WebAssembly.instantiate(bytes, importObject);
                instance = result.instance;
                console.log('[WASMOrchestrator] ASC module compiled (buffer)');
            }
            
            return instance;
        } catch (e) {
            console.warn('[WASMOrchestrator] ASC load error:', e);
            return null;
        }
    })();

    // ---------------------------------------------------------
    // 2. Start Loading Emscripten (Via Loader / Pthreads)
    // ---------------------------------------------------------
    const emccPromise = (async () => {
        try {
            // Check if WASM file exists first
            const wasmCheck = await checkWasmFileExists('candy_native.wasm');
            if (!wasmCheck.exists) {
                console.log('[WASMOrchestrator] candy_native.wasm not found, skipping EMCC module');
                return null;
            }

            const locatePrefix = wasmCheck.path;

            // Inspect the wasm exports first to detect mismatches or stale artifacts
            /*
            try {
                const exports = await inspectWasmExports('candy_native.wasm');
                console.log('[WASMOrchestrator] candy_native.wasm exports:', exports);
                const expected = ['calcSpeakerPulse','_calcSpeakerPulse','getSpeakerYOffset','_getSpeakerYOffset'];
                const hasExpected = exports && expected.some(n => exports.includes(n));
                if (!hasExpected) {
                    console.warn('[WASMOrchestrator] candy_native.wasm is missing expected exports; skipping EMCC module');
                    return null;
                }
            } catch (inspectErr) {
                console.warn('[WASMOrchestrator] Failed to inspect candy_native.wasm exports, continuing with loader:', inspectErr);
            }
            */

            // Import the generated JS loader
            let createCandyNative;
            try {
                const { default: creator } = await import(/* @vite-ignore */ `${locatePrefix}/candy_native.js?v=${Date.now()}`);
                createCandyNative = creator;
            } catch (jsError) {
                console.log('[WASMOrchestrator] candy_native.js not found, skipping EMCC module');
                return null;
            }
            
            // Patch instantiate() so Emscripten's assignWasmExports won't abort when only underscore names exist
            const restore = patchWasmInstantiateAliases();
            try {
                const instance = await createCandyNative({
                    locateFile: (path, prefix) => {
                        if (path.endsWith('.wasm')) return `${locatePrefix}/candy_native.wasm`;
                        if (path.endsWith('.worker.js')) return `${locatePrefix}/candy_native.worker.js`;
                        return prefix + path;
                    },
                    print: (text) => console.log('[Native]', text),
                    printErr: (text) => console.warn('[Native Err]', text),
                    // IMPORTANT: Pass our coordination buffer to C++ if needed
                    // orchestratorBuffer: syncBuffer 
                });

                console.log('[WASMOrchestrator] EMCC Pthreads module ready');
                return instance;
            } finally {
                restore();
            }
        } catch (e) {
            console.warn('[WASMOrchestrator] EMCC unavailable, using JS fallback:', e);
            return null;
        }
    })();

    // ---------------------------------------------------------
    // 3. Wait for Both
    // ---------------------------------------------------------
    const [ascInstance, emccInstance] = await Promise.all([ascPromise, emccPromise]);

    results.asc = ascInstance;
    results.emcc = emccInstance; // This is the Module object, not just the instance

    signalPhaseComplete(LOADING_PHASES.WASM_INIT);
    
    // ... Continue with your pipeline phases ...
    onProgress(LOADING_PHASES.READY, 'Ready');
    signalPhaseComplete(LOADING_PHASES.READY);

    return results;
}

// Stub exports for compatibility (required by wasm-loader.js imports)
export function createPlaceholderScene() { }
export function removePlaceholderScene() { }
