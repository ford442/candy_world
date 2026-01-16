/**
 * @file src/utils/wasm-loader.js
 * Partial update for loadEmscriptenModule
 */

// ... imports remain the same

async function loadEmscriptenModule(forceSingleThreaded = false) {
    const canUseThreads = typeof SharedArrayBuffer !== 'undefined' && !forceSingleThreaded;

    try {
        await updateProgress('Loading Native Engine...');

        let wasmFilename = 'candy_native.wasm';
        let jsFilename = 'candy_native.js';
        let isThreaded = true;

        if (!canUseThreads) {
            console.warn('[Native] Using Single-Threaded Fallback');
            wasmFilename = 'candy_native_st.wasm';
            jsFilename = 'candy_native_st.js';
            isThreaded = false;
        }

        // 1. Check if WASM file exists and GET THE CORRECT PATH
        const wasmCheck = await checkWasmFileExists(wasmFilename);
        if (!wasmCheck.exists) {
            console.log(`[WASM] ${wasmFilename} not found.`);
            if (isThreaded) return loadEmscriptenModule(true);
            return false;
        }

        // 2. Construct the full resolved path
        // Ensure we handle slashes correctly based on what checkWasmFileExists returned
        const prefix = wasmCheck.path || '';
        const cleanPrefix = prefix.endsWith('/') ? prefix : (prefix ? `${prefix}/` : '');
        const resolvedWasmPath = `${cleanPrefix}${wasmFilename}`;

        // Load the JS factory
        let createCandyNative;
        try {
            // Also use the prefix for the JS file if it's not absolute
            const jsPath = jsFilename.includes('://') ? jsFilename : `${cleanPrefix}${jsFilename}`;
            const module = await import(/* @vite-ignore */ `${jsPath}?v=${Date.now()}`);
            createCandyNative = module.default;
        } catch (e) {
            console.log(`[WASM] ${jsFilename} not found.`, e);
            if (isThreaded) return loadEmscriptenModule(true);
            return false;
        }

        if (isThreaded) {
            await updateProgress('Spawning Physics Workers...');
        } else {
            await updateProgress('Initializing Physics (ST)...');
        }

        const restore = patchWasmInstantiateAliases();
        let wasmBinary = null;

        try {
             // 3. USE THE RESOLVED PATH for the manual fetch
             const resp = await fetch(resolvedWasmPath);
             if (resp.ok) {
                 wasmBinary = await resp.arrayBuffer();
             } else {
                 throw new Error(`Fetch failed: ${resp.status}`);
             }
        } catch(e) {
            console.warn("[WASM] Failed to pre-fetch binary:", e);
        }

        try {
            const config = {
                // 4. Update locateFile to use our resolved prefix logic if needed
                locateFile: (path, scriptDirectory) => {
                    if (path.endsWith('.wasm')) return resolvedWasmPath;
                    return scriptDirectory + path;
                },
                print: (text) => console.log('[Native]', text),
                printErr: (text) => console.warn('[Native Err]', text),
            };

            if (wasmBinary) {
                config.wasmBinary = wasmBinary;
            }

            config.instantiateWasm = (imports, successCallback) => {
                let promise;
                if (wasmBinary) {
                    promise = WebAssembly.instantiate(wasmBinary, imports);
                } else {
                    // Fallback fetch using the correct path
                    promise = fetch(resolvedWasmPath)
                        .then(response => {
                            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
                            return response.arrayBuffer();
                        })
                        .then(bytes => WebAssembly.instantiate(bytes, imports));
                }

                promise.then(result => {
                    successCallback(result.instance, result.module);
                }).catch(e => {
                    console.error('[Native] Manual instantiation failed:', e);
                });

                return {}; 
            };

            emscriptenInstance = await createCandyNative(config);
            console.log(`[WASM] Emscripten ${isThreaded ? 'Pthreads' : 'Single-Threaded'} Ready`);

        } catch (e) {
            // ... Error handling logic remains the same
            console.warn('[WASM] Instantiation failed:', e);
            restore();
            if (isThreaded) return loadEmscriptenModule(true);
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
// ... rest of file
