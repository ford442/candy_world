import { CONFIG } from '../core/config.js';
import { toast } from './toast.js';

let wasmInstance = null;
let wasmMemory = null;
let heapU8 = null;
let heapU32 = null;
let heapF32 = null;
let heapU64 = null; // Add heap for BigInt64 if needed

const WASM_PATH = './candy_physics.wasm'; // Ensure this points to your AS or C++ module

// Safe helper to read BigInt pointer
function safePtr(ptr) {
    if (typeof ptr === 'bigint') {
        return Number(ptr); // Unsafe for > 2^53, but fine for WASM32 memory pointers
    }
    return ptr;
}

export async function initWasm() {
    if (window.CandyPhysics) {
        return true; // Already loaded
    }

    try {
        const response = await fetch(WASM_PATH);
        if (!response.ok) throw new Error(`Failed to fetch WASM: ${response.statusText}`);
        
        const buffer = await response.arrayBuffer();
        
        const importObject = {
            env: {
                // Common Emscripten/AS imports
                memory: new WebAssembly.Memory({ initial: 256, maximum: 2048 }),
                abort: (msg, file, line, column) => {
                    console.error(`WASM Abort: ${msg} @ ${file}:${line}:${column}`);
                },
                seed: () => Math.random(),
                now: () => Date.now(), // If WASM expects i64, this might fail without adapter
                
                // Fix for BigInt mixing: Ensure time is passed as Number (unless WASM explicitly asks for BigInt)
                // If you get "signature mismatch", we might need to wrap this.
            },
            // Emscripten specific imports usually go here
            wasi_snapshot_preview1: {
                clock_time_get: (id, precision, outPtr) => {
                    // Example shim: write current time to memory
                    const now = BigInt(Date.now()) * 1000000n; // Nanoseconds
                    if (heapU64) {
                         // Use BigInt for index calculation if outPtr is BigInt
                         const idx = typeof outPtr === 'bigint' ? Number(outPtr) : outPtr;
                         // Store as 64-bit int
                         const view = new BigInt64Array(wasmMemory.buffer);
                         view[idx >> 3] = now; 
                    }
                    return 0;
                },
                fd_write: () => 0, 
                fd_close: () => 0,
                fd_seek: () => 0,
                proc_exit: (code) => console.log("WASM Exit:", code)
            }
        };

        const module = await WebAssembly.instantiate(buffer, importObject);
        wasmInstance = module.instance;
        wasmMemory = wasmInstance.exports.memory || importObject.env.memory;
        
        // Initialize heaps
        heapU8 = new Uint8Array(wasmMemory.buffer);
        heapU32 = new Uint32Array(wasmMemory.buffer);
        heapF32 = new Float32Array(wasmMemory.buffer);
        // Only if BigInt is supported
        if (typeof BigInt64Array !== 'undefined') {
            heapU64 = new BigInt64Array(wasmMemory.buffer);
        }

        // Expose to global for debugging/main loop
        window.CandyPhysics = wasmInstance.exports;
        
        // Run explicit initializer if it exists (AssemblyScript often has this)
        if (wasmInstance.exports._start) wasmInstance.exports._start();
        if (wasmInstance.exports.__init) wasmInstance.exports.__init();

        console.log(`[WASM] Loaded. Exports:`, Object.keys(wasmInstance.exports));
        return true;

    } catch (e) {
        console.error("Failed to load WASM module:", e);
        // Try fallback or just fail gracefully
        toast("Physics Engine Failed to Load", "error");
        return false;
    }
}

// Wrapper to safely access exports without crashing if not loaded
export function getGroundHeight(x, z) {
    if (wasmInstance && wasmInstance.exports.getGroundHeight) {
        return wasmInstance.exports.getGroundHeight(x, z);
    }
    return 0; // Fallback
}

export const LOADING_PHASES = ["Fetching", "Compiling", "Linking", "Ready"];
export function isWasmReady() { return !!wasmInstance; }
export function initWasmParallel() { return initWasm(); } // Stub for parallel
