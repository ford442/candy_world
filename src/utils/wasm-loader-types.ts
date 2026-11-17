import * as THREE from 'three';
import type {
    AsExportName,
    AsExports,
    AsGlobals,
    CppModuleExports,
} from './native-exports.generated.ts';

export type {
    AsExportName,
    AsExports,
    AsGlobals,
    CppExportName,
    CppExports,
    NativePtr,
} from './native-exports.generated.ts';
// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * WASI stub functions
 */
export interface WasiStubs {
    fd_close: () => number;
    fd_seek: () => number;
    fd_write: () => number;
    fd_read: () => number;
    fd_fdstat_get: () => number;
    fd_prestat_get: () => number;
    fd_prestat_dir_name: () => number;
    path_open: () => number;
    environ_sizes_get: () => number;
    environ_get: () => number;
    proc_exit: () => void;
    clock_time_get: (id: number, precision: bigint, outPtr: number | bigint) => number;
}

/**
 * WASM import object
 */
export interface WasmImportObject {
    env: {
        abort: (msg: number, file: number, line: number, col: number) => void;
        seed: () => number;
        now: () => number;
    };
    wasi_snapshot_preview1: WasiStubs;
}

/**
 * Emscripten module interface
 */
export interface EmscriptenModule {
    wasmMemory?: WebAssembly.Memory;
    HEAP8?: Int8Array;
    HEAPU8?: Uint8Array;
    HEAP32?: Int32Array;
    HEAPF32?: Float32Array;
    _malloc?: (size: number) => number;
    _free?: (ptr: number) => void;
    [key: string]: unknown;
}

/**
 * The Emscripten module with its C++ exports (`_name`), typed from the C++
 * definitions by scripts/gen-native-types.mjs. Partial: the ST and MT builds
 * and a module that failed to load may lack some.
 */
export type ExtendedEmscriptenModule = EmscriptenModule & Partial<CppModuleExports>;

/**
 * Three.js Object3D-like interface for position
 */
export interface Positionable {
    position: {
        x: number;
        y: number;
        z: number;
    };
}

/**
 * Mushroom object with userData
 */
export interface Mushroom extends Positionable {
    userData: {
        radius?: number;
        capRadius?: number;
        capHeight?: number;
        isTrampoline?: boolean;
        colorIndex?: number;
    };
}

/**
 * Cave object with userData
 */
export interface Matrix4Like {
    elements: number[];
    clone: () => { elements: number[] };
}

export interface Vector3Like {
    x: number;
    y: number;
    z: number;
    clone: () => Vector3Like;
    applyMatrix4: (matrix: Matrix4Like) => Vector3Like;
}

export interface Cave extends Positionable {
    matrixWorld: Matrix4Like;
    userData: {
        isBlocked?: boolean;
        /** Gate centre in cave-local space; absent on caves without a water gate. */
        gatePosition?: Vector3Like;
    };
}

/**
 * Cloud object with userData
 */
export interface Cloud extends Positionable {
    scale: {
        x: number;
        y: number;
        z: number;
    };
    userData: {
        tier?: number;
    };
}

/**
 * Trampoline object
 */
export interface Trampoline extends Positionable {
    userData: {
        capRadius?: number;
        capHeight?: number;
    };
}

/**
 * Player state interface
 */
export interface PlayerState {
    position: {
        x: number;
        y: number;
        z: number;
    };
    velocity: {
        x: number;
        y: number;
        z: number;
    };
    isGrounded: boolean;
}

/** Any value an AS export can hold. */
export type WasmExportValue = AsExports[AsExportName] | WebAssembly.Global | WebAssembly.Memory;

/**
 * The AssemblyScript module's exports, typed from asc's own bindings by
 * scripts/gen-native-types.mjs (assembly/index.ts is the list). Functions are
 * optional because callers feature-test them; memory and the two functions
 * the loader validates at boot are required.
 */
export type WasmExports = Partial<AsExports> &
    Partial<AsGlobals> &
    Pick<AsExports, 'getGroundHeight' | 'freqToHue'> & {
        memory: WebAssembly.Memory;
    };

// Extend window for global functions
declare global {
    interface Window {
        NativeWebAssembly?: typeof WebAssembly;
    }
}
