/**
 * WASM bridge for unified ground-height queries (AS + optional C++).
 * Falls back to ground-height-core.ts when native exports are unavailable.
 */

import {
    wasmGetUnifiedGroundHeight,
    wasmBatchUnifiedGroundHeight,
    wasmClearGroundPlatforms,
    wasmAddGroundPlatform,
    wasmInvalidateGroundCache,
    wasmSetGroundCacheTTL,
    cppGetUnifiedGroundHeight,
    cppBatchUnifiedGroundHeight,
    cppClearGroundPlatforms,
    cppAddGroundPlatform,
    cppInvalidateGroundCache,
    cppSetGroundCacheTTL,
    getWasmInstance,
    getWasmMemory,
    getEmscriptenInstance,
    isWasmReady,
    isEmscriptenReady,
} from '../utils/wasm-loader-core.ts';
import type { GroundPlatform } from '../systems/ground-height-core.ts';
import {
    queryUnifiedGroundHeightJS,
    fillUnifiedGroundHeightsJS,
    invalidateJsGroundCache,
} from '../systems/ground-height-core.ts';

// Persistent batch buffers (AssemblyScript path)
let _batchInPtr: number | null = null;
let _batchOutPtr: number | null = null;
let _batchCapacity = 0;

// Persistent batch buffers (C++ path)
let _cppBatchInPtr: number | null = null;
let _cppBatchOutPtr: number | null = null;
let _cppBatchCapacity = 0;

export function isNativeUnifiedGroundReady(): boolean {
    return wasmGetUnifiedGroundHeight !== null;
}

export function syncGroundCacheTTLToNative(seconds: number): void {
    wasmSetGroundCacheTTL?.(seconds);
    cppSetGroundCacheTTL?.(seconds);
}

export function syncGroundPlatformsToNative(platforms: readonly GroundPlatform[]): void {
    if (wasmClearGroundPlatforms && wasmAddGroundPlatform) {
        wasmClearGroundPlatforms();
        for (let i = 0; i < platforms.length; i++) {
            const p = platforms[i];
            wasmAddGroundPlatform(p.minX, p.maxX, p.minZ, p.maxZ, p.maxY);
        }
    }
    if (cppClearGroundPlatforms && cppAddGroundPlatform) {
        cppClearGroundPlatforms();
        for (let i = 0; i < platforms.length; i++) {
            const p = platforms[i];
            cppAddGroundPlatform(p.minX, p.maxX, p.minZ, p.maxZ, p.maxY);
        }
    }
}

export function invalidateNativeGroundCache(): void {
    wasmInvalidateGroundCache?.();
    cppInvalidateGroundCache?.();
    invalidateJsGroundCache();
}

/**
 * Query unified ground height via native path when available, else JS core.
 */
export function queryUnifiedGroundHeight(
    x: number,
    z: number,
    now: number,
    getTerrainHeight: (x: number, z: number) => number,
    platforms: readonly GroundPlatform[]
): number {
    // 1. C++ single query (fastest when Emscripten loaded)
    if (cppGetUnifiedGroundHeight && isEmscriptenReady()) {
        return cppGetUnifiedGroundHeight(x, z, now);
    }

    // 2. AssemblyScript unified query (always available after TLA)
    if (wasmGetUnifiedGroundHeight && isWasmReady()) {
        return wasmGetUnifiedGroundHeight(x, z, now);
    }

    // 3. JS fallback — exact match to pre-migration logic
    return queryUnifiedGroundHeightJS(x, z, now, getTerrainHeight, platforms);
}

/**
 * Batch unified ground heights. Priority: C++ SIMD → AS → JS.
 */
export function fillUnifiedGroundHeights(
    positions: Float32Array,
    out: Float32Array,
    count: number,
    now: number,
    getTerrainHeight: (x: number, z: number) => number,
    platforms: readonly GroundPlatform[]
): void {
    // 1. C++ batch (terrain SIMD + per-point modifiers/cache)
    if (cppBatchUnifiedGroundHeight && isEmscriptenReady()) {
        const em = getEmscriptenInstance();
        if (em?._malloc && em._free) {
            if (_cppBatchCapacity < count) {
                if (_cppBatchInPtr) em._free(_cppBatchInPtr);
                if (_cppBatchOutPtr) em._free(_cppBatchOutPtr);
                const cap = Math.max(count, _cppBatchCapacity * 2 || 64);
                _cppBatchInPtr = em._malloc(cap * 2 * 4);
                _cppBatchOutPtr = em._malloc(cap * 4);
                _cppBatchCapacity = cap;
            }
            if (_cppBatchInPtr && _cppBatchOutPtr) {
                em.HEAPF32!.set(positions.subarray(0, count * 2), _cppBatchInPtr >> 2);
                cppBatchUnifiedGroundHeight(_cppBatchInPtr, count, _cppBatchOutPtr, now);
                out.set(em.HEAPF32!.subarray(_cppBatchOutPtr >> 2, (_cppBatchOutPtr >> 2) + count));
                return;
            }
        }
    }

    // 2. AssemblyScript batch
    if (wasmBatchUnifiedGroundHeight && isWasmReady() && getWasmMemory()) {
        const exports = getWasmInstance()!.exports as {
            malloc?: (n: number) => number;
            free?: (p: number) => void;
            __new?: (size: number, id: number) => number;
            __free?: (p: number) => void;
        };
        const wasmMalloc = exports.malloc ?? exports.__new;
        const wasmFree = exports.free ?? exports.__free;
        if (wasmMalloc && wasmFree) {
            if (_batchCapacity < count) {
                if (_batchInPtr) wasmFree(_batchInPtr);
                if (_batchOutPtr) wasmFree(_batchOutPtr);
                const cap = Math.max(count, _batchCapacity * 2 || 64);
                _batchInPtr = wasmMalloc(cap * 2 * 4);
                _batchOutPtr = wasmMalloc(cap * 4);
                _batchCapacity = cap;
            }
            if (_batchInPtr && _batchOutPtr) {
                const mem = getWasmMemory()!;
                new Float32Array(mem, _batchInPtr, count * 2).set(positions.subarray(0, count * 2));
                wasmBatchUnifiedGroundHeight(_batchInPtr, count, _batchOutPtr, now);
                out.set(new Float32Array(mem, _batchOutPtr, count));
                return;
            }
        }
    }

    // 3. JS fallback
    fillUnifiedGroundHeightsJS(positions, out, count, now, getTerrainHeight, platforms);
}

/** Microbench helper: which backend served the last conceptual path. */
export function getUnifiedGroundBackend(): 'cpp' | 'as' | 'js' {
    if (cppGetUnifiedGroundHeight && isEmscriptenReady()) return 'cpp';
    if (wasmGetUnifiedGroundHeight && isWasmReady()) return 'as';
    return 'js';
}

/**
 * Batch unified ground heights into a new Float32Array.
 * Alias for tooling that previously called batchGroundHeightWithPlatforms.
 */
export function batchGroundHeightWithPlatforms(
    positions: Float32Array,
    getTerrainHeight: (x: number, z: number) => number,
    platforms: readonly GroundPlatform[]
): Float32Array {
    const count = positions.length / 2;
    const out = new Float32Array(count);
    fillUnifiedGroundHeights(positions, out, count, performance.now(), getTerrainHeight, platforms);
    return out;
}
