/**
 * UPDATED: Load Emscripten Module (Pthreads/Worker Version)
 * Fixes URL resolution and instantiation errors
 */
async function loadEmscriptenModule(forceSingleThreaded = false) {
    // SINGLE-THREADED FALLBACK STRATEGY:
    // 1. If SharedArrayBuffer is missing, forcing ST.
    // 2. If forceSingleThreaded=true is passed (recursive fallback), use ST.
    // 3. We attempt to load 'candy_native.wasm' (threaded).
    // 4. If that fails (file missing, instantiation error, worker error), we recursively call loadEmscriptenModule(true).

    // 1. Check for SharedArrayBuffer (required for threads)
    const canUseThreads = typeof SharedArrayBuffer !== 'undefined' && !forceSingleThreaded;

    try {
        await updateProgress('Loading Native Engine...');

        let wasmFilename = 'candy_native.wasm';
        let jsFilename = 'candy_native.js';
        let isThreaded = true;

        if (!canUseThreads) {
            console.warn('[Native] Using Single-Threaded Fallback (No SharedArrayBuffer or forced ST)');
            wasmFilename = 'candy_native_st.wasm';
            jsFilename = 'candy_native_st.js';
            isThreaded = false;
        }

        // 2. Check if WASM file exists and RESOLVE THE CORRECT PATH
        const wasmCheck = await checkWasmFileExists(wasmFilename);
        if (!wasmCheck.exists) {
            console.log(`[WASM] ${wasmFilename} not found. Using JS fallback.`);
            if (isThreaded) return loadEmscriptenModule(true);
            return false;
        }

        // Construct the full resolved path based on checkWasmFileExists result
        const prefix = wasmCheck.path || '';
        const cleanPrefix = prefix.endsWith('/') ? prefix : (prefix ? `${prefix}/` : '');
        const resolvedWasmPath = `${cleanPrefix}${wasmFilename}`;
        const resolvedJsPath = jsFilename.includes('://') ? jsFilename : `${cleanPrefix}${jsFilename}`;

        // Load the JS factory
        let createCandyNative;
        try {
            const module = await import(/* @vite-ignore */ `${resolvedJsPath}?v=${Date.now()}`);
            createCandyNative = module.default;
        } catch (e) {
            console.log(`[WASM] ${jsFilename} not found. Fallback?`, e);
            if (isThreaded) return loadEmscriptenModule(true);
            return false;
        }

        if (isThreaded) {
            await updateProgress('Spawning Physics Workers...');
        } else {
            await updateProgress('Initializing Physics (ST)...');
        }

        // Apply aliases
        const restore = patchWasmInstantiateAliases();

        // Manual binary fetch (optional, but good for caching/progress)
        let wasmBinary = null;
        try {
             const resp = await fetch(resolvedWasmPath);
             if (resp.ok) {
                 wasmBinary = await resp.arrayBuffer();
             } else {
                 console.warn(`[WASM] Pre-fetch failed with status: ${resp.status}`);
             }
        } catch(e) {
            console.warn("[WASM] Failed to pre-fetch binary:", e);
        }

        try {
            const config = {
                // Critical: Explicitly tell Emscripten where to find the file
                locateFile: (path, scriptDirectory) => {
                    if (path.endsWith('.wasm')) return resolvedWasmPath;
                    return scriptDirectory + path;
                },
                print: (text) => console.log('[Native]', text),
                printErr: (text) => console.warn('[Native Err]', text),
                
                // IMPORTANT: Do NOT set wasmBinary in config. 
                // Providing it alongside instantiateWasm can cause the "Argument 0 must be a Module" error
                // because Emscripten might try to synchronously instantiate it incorrectly.
                
                // Bypass internal instantiation logic completely
                instantiateWasm: (imports, successCallback) => {
                    console.log('[Native] Manual instantiation hook triggered');

                    const run = async () => {
                        try {
                            let bytes = wasmBinary;
                            
                            // Fallback fetch if pre-fetch failed
                            if (!bytes) {
                                console.log('[Native] Fetching binary inside hook...');
                                const response = await fetch(resolvedWasmPath);
                                if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
                                bytes = await response.arrayBuffer();
                            }

                            // Explicitly Compile first, then Instantiate. 
                            // This ensures we have a valid Module object to pass to successCallback.
                            const module = await WebAssembly.compile(bytes);
                            const instance = await WebAssembly.instantiate(module, imports);
                            
                            console.log('[Native] Manual instantiation success');
                            successCallback(instance, module);
                        } catch (e) {
                            console.error('[Native] Manual instantiation failed:', e);
                            // We can't easily reject the outer promise from here, but logging helps.
                        }
                    };

                    run();
                    return {}; // Async indicates to Emscripten we are handling it
                }
            };

            emscriptenInstance = await createCandyNative(config);
            console.log(`[WASM] Emscripten ${isThreaded ? 'Pthreads' : 'Single-Threaded'} Ready`);

        } catch (e) {
            console.warn('[WASM] Instantiation failed:', e);
            restore();
            // If threaded failed, try ST
            if (isThreaded) {
                console.log('[WASM] Falling back to Single-Threaded build...');
                return loadEmscriptenModule(true);
            }
            return false;
        } finally {
            restore();
        }

        if (emscriptenInstance.wasmMemory) {
            emscriptenMemory = emscriptenInstance.wasmMemory;
        } else if (emscriptenInstance.HEAP8) {
            emscriptenMemory = emscriptenInstance.HEAP8.buffer;
        }

        return true;
    } catch (e) {
        console.warn('[WASM] Native module unavailable:', e);
        return false;
    }
}
