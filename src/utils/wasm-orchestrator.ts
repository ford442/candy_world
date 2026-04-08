// WASM-First GPU Pipeline Orchestrator
// Updated for Emscripten Pthreads Support

import { checkWasmFileExists, inspectWasmExports, patchWasmInstantiateAliases } from './wasm-utils.js';

/**
 * Loading phase constants
 */
export const LOADING_PHASES = {
    WASM_INIT: 0,
    ASSET_DECODE: 1,
    GPU_UPLOAD: 2,
    PIPELINE_WARMUP: 3,
    READY: 4
} as const;

/**
 * Phase status constants
 */
export const PHASE_STATUS = {
    PENDING: 0,
    IN_PROGRESS: 1,
    COMPLETE: 2,
    ERROR: -1
} as const;

/**
 * Type for loading phases
 */
export type LoadingPhase = typeof LOADING_PHASES[keyof typeof LOADING_PHASES];

/**
 * Type for phase status
 */
export type PhaseStatus = typeof PHASE_STATUS[keyof typeof PHASE_STATUS];

// --- Shared Memory Utilities (Keep your existing code here) ---
let syncBuffer: SharedArrayBuffer | null = null;
let syncView: Int32Array | null = null;

/**
 * Get the shared coordination buffer
 * @returns The shared buffer or null if not initialized
 */
export function getSharedBuffer(): SharedArrayBuffer | null {
    return syncBuffer;
}

/**
 * Check if shared memory (SharedArrayBuffer) is available
 * @returns True if SharedArrayBuffer is supported and functional
 */
export function isSharedMemoryAvailable(): boolean {
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

/**
 * Initialize the shared coordination buffer
 * @returns True if initialization succeeded
 */
export function initSharedBuffer(): boolean {
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

/**
 * Signal that a phase is complete
 * @param phase - The phase number to mark as complete
 */
export function signalPhaseComplete(phase: number): void {
    if (!syncView) return;
    Atomics.store(syncView, phase, PHASE_STATUS.COMPLETE);
    Atomics.notify(syncView, phase);
    console.log(`[WASMOrchestrator] Phase ${phase} complete`);
}

/**
 * Signal that a phase has started
 * @param phase - The phase number to mark as in progress
 */
export function signalPhaseStart(phase: number): void {
    if (!syncView) return;
    Atomics.store(syncView, phase, PHASE_STATUS.IN_PROGRESS);
}

/**
 * WASI stub functions for AssemblyScript
 */
interface WasiStubs {
    fd_write: () => number;
    abort: () => void;
    clock_time_get: () => number;
}

/**
 * Import object for WebAssembly instantiation
 */
interface WasmImportObject {
    env: {
        abort: () => void;
        seed: () => number;
    };
    wasi_snapshot_preview1: WasiStubs;
}

/**
 * WebAssembly instance with exports
 */
interface WasmInstance {
    exports: WebAssembly.Exports;
}

/**
 * Emscripten module instance
 */
interface EmscriptenModule {
    wasmMemory?: WebAssembly.Memory;
    HEAP8?: Int8Array;
    [key: string]: unknown;
}

/**
 * Options for parallel WASM loading
 */
export interface ParallelWasmLoadOptions {
    /** Progress callback function */
    onProgress?: (phase: number, message: string) => void;
    /** URL for AssemblyScript WASM */
    ascWasmUrl?: string;
    /** Cache version string */
    cacheVersion?: string;
}

/**
 * Results from parallel WASM loading
 */
export interface ParallelWasmLoadResult {
    /** AssemblyScript instance */
    asc: WasmInstance | null;
    /** Emscripten module instance */
    emcc: EmscriptenModule | null;
}

/**
 * Parallel WASM Module Loader
 * - ASC: Loaded Manually (Standalone)
 * - EMCC: Loaded via Generated Loader (Pthreads)
 */
export async function parallelWasmLoad(options: ParallelWasmLoadOptions = {}): Promise<ParallelWasmLoadResult> {
    const {
        onProgress = () => {},
        ascWasmUrl = './candy_physics.wasm',
        cacheVersion = ''
    } = options;

    const buildUrl = (baseUrl: string): string => cacheVersion ? `${baseUrl}?v=${cacheVersion}` : baseUrl;

    initSharedBuffer();
    
    onProgress(LOADING_PHASES.WASM_INIT, 'Initializing WASM modules...');
    signalPhaseStart(LOADING_PHASES.WASM_INIT);

    const results: ParallelWasmLoadResult = { asc: null, emcc: null };

    // ---------------------------------------------------------
    // 1. Start Loading ASC (Manual / Standalone)
    // ---------------------------------------------------------
    const ascPromise = (async (): Promise<WasmInstance | null> => {
        try {
            // Minimal WASI stubs for AssemblyScript
            const wasiStubs: WasiStubs = {
                fd_write: () => 0,
                abort: () => {},
                clock_time_get: () => performance.now()
            };

            const importObject: WasmImportObject = {
                env: {
                    abort: () => console.error("ASC Abort"),
                    seed: () => Math.random()
                },
                wasi_snapshot_preview1: wasiStubs
            };

            // Try streaming instantiation first for faster compilation
            let instance: WasmInstance;
            try {
                const result = await WebAssembly.instantiateStreaming(
                    fetch(buildUrl(ascWasmUrl)),
                    importObject as unknown as WebAssembly.Imports
                );
                instance = result.instance as WasmInstance;
                console.log('[WASMOrchestrator] ASC module compiled (streaming)');
            } catch (streamError) {
                console.log('[WASMOrchestrator] Streaming failed, using fallback:', streamError);
                // Fallback to traditional method
                const response = await fetch(buildUrl(ascWasmUrl));
                if (!response.ok) return null;
                const bytes = await response.arrayBuffer();
                const result = await WebAssembly.instantiate(bytes, importObject as unknown as WebAssembly.Imports);
                instance = result.instance as WasmInstance;
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
    const emccPromise = (async (): Promise<EmscriptenModule | null> => {
        try {
            // Check if WASM file exists first
            const wasmCheck = await checkWasmFileExists('candy_native.wasm');
            if (!wasmCheck.exists) {
                console.log('[WASMOrchestrator] candy_native.wasm not found, skipping EMCC module');
                return null;
            }

            const locatePrefix = wasmCheck.path;

            // Import the generated JS loader
            let createCandyNative: ((config: Record<string, unknown>) => Promise<EmscriptenModule>) | undefined;
            try {
                const { default: creator } = await import(/* @vite-ignore */ `${locatePrefix}/candy_native.js?v=${Date.now()}`);
                createCandyNative = creator;
            } catch (jsError) {
                console.log('[WASMOrchestrator] candy_native.js not found, skipping EMCC module');
                return null;
            }
            
            if (!createCandyNative) return null;
            
            // Patch instantiate() so Emscripten's assignWasmExports won't abort when only underscore names exist
            const restore = patchWasmInstantiateAliases();
            try {
                const instance = await createCandyNative({
                    locateFile: (path: string, prefix: string) => {
                        if (path.endsWith('.wasm')) return `${locatePrefix}/candy_native.wasm`;
                        if (path.endsWith('.worker.js')) return `${locatePrefix}/candy_native.worker.js`;
                        return prefix + path;
                    },
                    print: (text: string) => console.log('[Native]', text),
                    printErr: (text: string) => console.warn('[Native Err]', text),
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
export function createPlaceholderScene(): void { }
export function removePlaceholderScene(): void { }
