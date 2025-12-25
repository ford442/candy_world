// WASM-First GPU Pipeline Orchestrator
// Implements parallel WASM module loading with SharedArrayBuffer coordination

/**
 * Loading phases for WASM orchestration
 * Used for cross-module synchronization via SharedArrayBuffer
 */
export const LOADING_PHASES = {
    WASM_INIT: 0,
    ASSET_DECODE: 1,
    GPU_UPLOAD: 2,
    PIPELINE_WARMUP: 3,
    READY: 4
};

/**
 * Phase status values for atomic operations
 */
export const PHASE_STATUS = {
    PENDING: 0,
    IN_PROGRESS: 1,
    COMPLETE: 2,
    ERROR: -1
};

// Shared memory for cross-module coordination (when available)
let syncBuffer = null;
let syncView = null;

/**
 * Check if SharedArrayBuffer is available
 * Requires proper COOP/COEP headers for cross-origin isolation
 */
export function isSharedMemoryAvailable() {
    try {
        // Check if SharedArrayBuffer is available (requires crossOriginIsolated)
        if (typeof SharedArrayBuffer === 'undefined') {
            return false;
        }
        // Test creating a small buffer
        const test = new SharedArrayBuffer(4);
        const view = new Int32Array(test);
        Atomics.store(view, 0, 1);
        return Atomics.load(view, 0) === 1;
    } catch (e) {
        console.warn('[WASMOrchestrator] SharedArrayBuffer not available:', e.message);
        return false;
    }
}

/**
 * Initialize the shared coordination buffer
 * @returns {boolean} True if shared memory was initialized
 */
export function initSharedBuffer() {
    if (syncBuffer !== null) {
        return true; // Already initialized
    }

    if (!isSharedMemoryAvailable()) {
        console.log('[WASMOrchestrator] Running in single-threaded mode (no SharedArrayBuffer)');
        return false;
    }

    try {
        // 5 Int32 values: one for each phase status
        syncBuffer = new SharedArrayBuffer(5 * Int32Array.BYTES_PER_ELEMENT);
        syncView = new Int32Array(syncBuffer);
        
        // Initialize all phases to PENDING
        for (let i = 0; i < 5; i++) {
            Atomics.store(syncView, i, PHASE_STATUS.PENDING);
        }
        
        console.log('[WASMOrchestrator] Shared coordination buffer initialized');
        return true;
    } catch (e) {
        console.warn('[WASMOrchestrator] Failed to init shared buffer:', e);
        return false;
    }
}

/**
 * Get the shared buffer for passing to WASM modules or workers
 * @returns {SharedArrayBuffer|null}
 */
export function getSharedBuffer() {
    return syncBuffer;
}

/**
 * Signal that a phase has completed
 * @param {number} phase - One of LOADING_PHASES values
 */
export function signalPhaseComplete(phase) {
    if (!syncView) return;
    
    try {
        Atomics.store(syncView, phase, PHASE_STATUS.COMPLETE);
        Atomics.notify(syncView, phase);
        console.log(`[WASMOrchestrator] Phase ${phase} complete`);
    } catch (e) {
        console.warn('[WASMOrchestrator] Failed to signal phase:', e);
    }
}

/**
 * Signal that a phase has started
 * @param {number} phase - One of LOADING_PHASES values
 */
export function signalPhaseStart(phase) {
    if (!syncView) return;
    
    try {
        Atomics.store(syncView, phase, PHASE_STATUS.IN_PROGRESS);
    } catch (e) {
        console.warn('[WASMOrchestrator] Failed to signal phase start:', e);
    }
}

/**
 * Check if a phase has completed
 * @param {number} phase - One of LOADING_PHASES values
 * @returns {boolean}
 */
export function isPhaseComplete(phase) {
    if (!syncView) return true; // Fallback: assume complete if no coordination
    
    try {
        return Atomics.load(syncView, phase) === PHASE_STATUS.COMPLETE;
    } catch (e) {
        return true; // Fallback on error
    }
}

/**
 * Wait for a phase to complete (async/non-blocking)
 * Uses Atomics.waitAsync when available, otherwise polls
 * @param {number} phase - One of LOADING_PHASES values
 * @param {number} timeout - Max wait time in ms (default 30000)
 * @returns {Promise<boolean>} True if phase completed, false on timeout
 */
export async function waitForPhase(phase, timeout = 30000) {
    if (!syncView) return true; // No coordination, proceed immediately
    
    const startTime = Date.now();
    
    // Check if already complete
    if (Atomics.load(syncView, phase) === PHASE_STATUS.COMPLETE) {
        return true;
    }
    
    // Try Atomics.waitAsync if available (non-blocking)
    if (typeof Atomics.waitAsync === 'function') {
        try {
            const result = Atomics.waitAsync(syncView, phase, PHASE_STATUS.PENDING, timeout);
            if (result.async) {
                await result.value;
                return Atomics.load(syncView, phase) === PHASE_STATUS.COMPLETE;
            }
            // Sync result
            return Atomics.load(syncView, phase) === PHASE_STATUS.COMPLETE;
        } catch (e) {
            console.warn('[WASMOrchestrator] waitAsync failed, falling back to polling:', e);
        }
    }
    
    // Fallback: Polling with yields to event loop
    while (Date.now() - startTime < timeout) {
        if (Atomics.load(syncView, phase) === PHASE_STATUS.COMPLETE) {
            return true;
        }
        // Yield to event loop
        await new Promise(r => setTimeout(r, 10));
    }
    
    console.warn(`[WASMOrchestrator] Timeout waiting for phase ${phase}`);
    return false;
}

/**
 * Parallel WASM Module Loader
 * Loads both AssemblyScript and Emscripten modules simultaneously
 * 
 * @param {Object} options
 * @param {Function} options.onProgress - Progress callback (phase, message)
 * @param {string} options.ascWasmUrl - AssemblyScript WASM URL
 * @param {string} options.emccWasmUrl - Emscripten WASM URL  
 * @returns {Promise<{asc: Object|null, emcc: Object|null, sharedBuffer: SharedArrayBuffer|null}>}
 */
export async function parallelWasmLoad(options = {}) {
    const {
        onProgress = () => {},
        ascWasmUrl = './candy_physics.wasm',
        emccWasmUrl = './candy_native.wasm'
    } = options;

    // Initialize shared coordination
    const hasSharedMemory = initSharedBuffer();
    
    onProgress(LOADING_PHASES.WASM_INIT, 'Initializing WASM modules...');
    signalPhaseStart(LOADING_PHASES.WASM_INIT);

    // Start both module loads in parallel
    const loadPromises = [];
    const results = { asc: null, emcc: null, sharedBuffer: getSharedBuffer() };

    // AssemblyScript module load
    const ascPromise = (async () => {
        try {
            const response = await fetch(ascWasmUrl + '?v=' + Date.now());
            if (!response.ok) {
                console.warn('[WASMOrchestrator] ASC WASM not found');
                return null;
            }
            const bytes = await response.arrayBuffer();
            
            // Validate WASM magic number
            const magic = new Uint8Array(bytes.slice(0, 4));
            if (magic[0] !== 0x00 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
                console.error('[WASMOrchestrator] Invalid ASC WASM file');
                return null;
            }
            
            return { bytes, type: 'asc' };
        } catch (e) {
            console.warn('[WASMOrchestrator] ASC load error:', e);
            return null;
        }
    })();
    loadPromises.push(ascPromise);

    // Emscripten module load
    const emccPromise = (async () => {
        try {
            const response = await fetch(emccWasmUrl + '?v=' + Date.now());
            if (!response.ok) {
                console.log('[WASMOrchestrator] EMCC WASM not found (optional)');
                return null;
            }
            const bytes = await response.arrayBuffer();
            
            // Validate WASM magic number
            const magic = new Uint8Array(bytes.slice(0, 4));
            if (magic[0] !== 0x00 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
                console.warn('[WASMOrchestrator] Invalid EMCC WASM file');
                return null;
            }
            
            return { bytes, type: 'emcc' };
        } catch (e) {
            console.warn('[WASMOrchestrator] EMCC load error:', e);
            return null;
        }
    })();
    loadPromises.push(emccPromise);

    // Wait for both downloads
    const [ascData, emccData] = await Promise.all(loadPromises);
    
    signalPhaseComplete(LOADING_PHASES.WASM_INIT);
    onProgress(LOADING_PHASES.ASSET_DECODE, 'Compiling WASM modules...');
    signalPhaseStart(LOADING_PHASES.ASSET_DECODE);

    // Compile both modules in parallel
    const WA = window.NativeWebAssembly || WebAssembly;
    
    const wasiStubs = {
        fd_close: () => 0,
        fd_seek: () => 0,
        fd_write: () => 0,
        fd_read: () => 0,
        fd_fdstat_get: () => 0,
        fd_prestat_get: () => 0,
        fd_prestat_dir_name: () => 0,
        path_open: () => 0,
        environ_sizes_get: () => 0,
        environ_get: () => 0,
        proc_exit: () => {},
        clock_time_get: () => 0
    };

    const compilePromises = [];

    // Compile ASC
    if (ascData) {
        const ascCompile = (async () => {
            try {
                const importObject = {
                    env: {
                        abort: (msg, file, line, col) => {
                            console.error(`[ASC] WASM abort at ${file}:${line}:${col}: ${msg}`);
                        }
                    },
                    wasi_snapshot_preview1: wasiStubs
                };
                
                const result = await WA.instantiate(ascData.bytes, importObject);
                results.asc = result.instance;
                console.log('[WASMOrchestrator] ASC module compiled');
            } catch (e) {
                console.warn('[WASMOrchestrator] ASC compile error:', e);
            }
        })();
        compilePromises.push(ascCompile);
    }

    // Compile EMCC
    if (emccData) {
        const emccCompile = (async () => {
            try {
                const importObject = {
                    wasi_snapshot_preview1: wasiStubs,
                    env: { emscripten_notify_memory_growth: () => {} }
                };
                
                const result = await WA.instantiate(emccData.bytes, importObject);
                results.emcc = result.instance;
                console.log('[WASMOrchestrator] EMCC module compiled');
            } catch (e) {
                console.warn('[WASMOrchestrator] EMCC compile error:', e);
            }
        })();
        compilePromises.push(emccCompile);
    }

    await Promise.all(compilePromises);
    
    signalPhaseComplete(LOADING_PHASES.ASSET_DECODE);
    onProgress(LOADING_PHASES.GPU_UPLOAD, 'Preparing GPU resources...');
    signalPhaseStart(LOADING_PHASES.GPU_UPLOAD);

    // GPU resource preparation would happen here
    // For now, we just signal completion
    signalPhaseComplete(LOADING_PHASES.GPU_UPLOAD);

    onProgress(LOADING_PHASES.PIPELINE_WARMUP, 'Warming up render pipeline...');
    signalPhaseStart(LOADING_PHASES.PIPELINE_WARMUP);
    signalPhaseComplete(LOADING_PHASES.PIPELINE_WARMUP);

    onProgress(LOADING_PHASES.READY, 'Ready');
    signalPhaseComplete(LOADING_PHASES.READY);

    return results;
}

/**
 * Create a placeholder scene for tiered loading (Strategy 5)
 * This is a lightweight low-poly scene to show while high-fidelity assets load
 * 
 * @param {THREE.Scene} scene - The main scene to add placeholders to
 * @returns {THREE.Group} The placeholder group (can be removed later)
 */
export function createPlaceholderScene(THREE, scene) {
    const placeholderGroup = new THREE.Group();
    placeholderGroup.name = 'placeholder_scene';
    
    // Simple ground plane
    const groundGeom = new THREE.PlaneGeometry(200, 200, 2, 2);
    groundGeom.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshBasicMaterial({ 
        color: 0x98FB98, // Pale green
        side: THREE.DoubleSide
    });
    const ground = new THREE.Mesh(groundGeom, groundMat);
    ground.position.y = 0;
    placeholderGroup.add(ground);
    
    // Simple placeholder trees (just cones)
    const treeGeom = new THREE.ConeGeometry(2, 8, 6);
    const treeMat = new THREE.MeshBasicMaterial({ color: 0x228B22 }); // Forest green
    
    for (let i = 0; i < 10; i++) {
        const tree = new THREE.Mesh(treeGeom, treeMat);
        tree.position.set(
            (Math.random() - 0.5) * 100,
            4,
            (Math.random() - 0.5) * 100
        );
        placeholderGroup.add(tree);
    }
    
    // Simple sky sphere
    const skyGeom = new THREE.SphereGeometry(800, 8, 8);
    const skyMat = new THREE.MeshBasicMaterial({
        color: 0x87CEEB, // Sky blue
        side: THREE.BackSide
    });
    const sky = new THREE.Mesh(skyGeom, skyMat);
    placeholderGroup.add(sky);
    
    scene.add(placeholderGroup);
    
    return placeholderGroup;
}

/**
 * Remove the placeholder scene when full scene is ready
 * @param {THREE.Scene} scene
 * @param {THREE.Group} placeholderGroup
 */
export function removePlaceholderScene(scene, placeholderGroup) {
    if (placeholderGroup && placeholderGroup.parent === scene) {
        scene.remove(placeholderGroup);
        
        // Dispose geometries and materials
        placeholderGroup.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
        
        console.log('[WASMOrchestrator] Placeholder scene removed');
    }
}
