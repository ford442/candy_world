/**
 * @file wasm-music-reactivity.ts
 * @brief AS bridge for arpeggio_grove channel volume accumulate + nightGate scale (#1364)
 *
 * Native: assembly/music_reactivity.ts → accumulateArpeggioChannels
 * Fallback: allocation-free TypeScript (parity with MusicReactivitySystem)
 *
 * Feature flag (A/B):
 *   ?nativeMusicAccum=0  — force TS path
 *   ?nativeMusicAccum=1  — prefer native (same as default when export present)
 *   absent               — default ON when WASM export is present
 */

import { wasmInstance, getWasmMemory } from './wasm-loader-core.ts';
import type { WasmExports } from './wasm-loader-core.ts';

let _inPtr = 0;
let _outPtr = 0;
let _capacity = 0;

/** Cached URL flag: null = default (on when ready), false = force off, true = prefer on. */
let _flagCache: boolean | null | undefined = undefined;

function resolveNativeMusicAccumFlag(): boolean | null {
    if (_flagCache !== undefined) return _flagCache;
    try {
        if (typeof window === 'undefined') {
            _flagCache = null;
            return _flagCache;
        }
        const raw = new URLSearchParams(window.location.search).get('nativeMusicAccum');
        if (raw === null) {
            _flagCache = null;
        } else if (raw === '0' || raw === 'false' || raw === 'off') {
            _flagCache = false;
        } else {
            // '1' / 'true' / 'on' / any other value → prefer native
            _flagCache = true;
        }
    } catch {
        _flagCache = null;
    }
    return _flagCache;
}

/** True when AS export is callable on the loaded candy_physics instance. */
export function isNativeMusicAccumReady(): boolean {
    if (!wasmInstance) return false;
    const exports = wasmInstance.exports as WasmExports;
    return typeof exports.accumulateArpeggioChannels === 'function';
}

/**
 * Whether the hot path should attempt the native accumulator.
 * Default ON when the WASM export is present; `?nativeMusicAccum=0` forces TS.
 */
export function isNativeMusicAccumEnabled(): boolean {
    const flag = resolveNativeMusicAccumFlag();
    if (flag === false) return false;
    return isNativeMusicAccumReady();
}

/** Test/reset helper — clears cached URL flag (parity / unit tests). */
export function _resetNativeMusicAccumFlagCacheForTests(): void {
    _flagCache = undefined;
}

// =============================================================================
// TEST-ONLY / PARITY REFERENCE ENTRYPOINT (#1351)
// Pure typed-array accumulate — mirrors assembly/music_reactivity.ts and the
// MusicReactivitySystem arpeggio_grove shimmer/hueShift + nightGate scale.
// =============================================================================

/**
 * Accumulate arpeggio_grove shimmer + hueShift volumes.
 * volumes: packed [shimmer..., hueShift...] length shimmerCount+hueShiftCount
 * outResult: [shimmer, hueShift] already scaled by nightGate * intensityScale
 */
export function accumulateArpeggioChannelsTS(
    volumes: Float32Array,
    shimmerCount: number,
    hueShiftCount: number,
    nightGate: number,
    intensityScale: number,
    outResult: Float32Array
): void {
    let shimmerAccum = 0.0;
    for (let i = 0; i < shimmerCount; i++) {
        shimmerAccum += volumes[i];
    }

    let hueShiftAccum = 0.0;
    const end = shimmerCount + hueShiftCount;
    for (let i = shimmerCount; i < end; i++) {
        hueShiftAccum += volumes[i];
    }

    const shimmerDiv = shimmerCount > 1 ? shimmerCount : 1.0;
    let shimmerVal = shimmerAccum / shimmerDiv;
    if (shimmerVal > 1.0) shimmerVal = 1.0;
    outResult[0] = shimmerVal * nightGate * intensityScale;

    const hueShiftDiv = hueShiftCount > 1 ? hueShiftCount : 1.0;
    let hueShiftVal = hueShiftAccum / hueShiftDiv;
    if (hueShiftVal > 1.0) hueShiftVal = 1.0;
    outResult[1] = hueShiftVal * nightGate * intensityScale;
}

/** nightGate: 1.0 at night (bias=0) → 0.2 at full day (bias=1) */
export function nightGateFromBias(dayNightBias: number): number {
    return 0.2 + (1.0 - dayNightBias) * 0.8;
}

export function accumulateArpeggioChannelsNative(
    volumes: Float32Array,
    shimmerCount: number,
    hueShiftCount: number,
    nightGate: number,
    intensityScale: number,
    outResult: Float32Array // length 2: [shimmer, hueShift]
): boolean {
    if (!wasmInstance) return false;
    const exports = wasmInstance.exports as WasmExports;
    const accumulateArpeggioChannels = exports.accumulateArpeggioChannels as Function | undefined;
    if (!accumulateArpeggioChannels) return false;

    const totalCount = shimmerCount + hueShiftCount;
    if (totalCount === 0) {
        outResult[0] = 0;
        outResult[1] = 0;
        return true;
    }

    const wasmMalloc = exports.malloc || exports.__new;
    const wasmFree = exports.free || exports.__free;

    if (!wasmMalloc) return false;

    if (_capacity < totalCount) {
        if (_inPtr && wasmFree) wasmFree(_inPtr);
        if (_outPtr && wasmFree) wasmFree(_outPtr);
        const newCap = Math.max(totalCount, _capacity * 2 || 32);

        _inPtr = wasmMalloc(newCap * 4);
        _outPtr = wasmMalloc(2 * 4);
        _capacity = newCap;
    }

    if (!_inPtr || !_outPtr) return false;

    const mem = getWasmMemory();
    if (!mem) return false;

    // Fast copy
    new Float32Array((mem as unknown as { buffer: ArrayBuffer }).buffer || mem, _inPtr, totalCount).set(volumes.subarray(0, totalCount));

    accumulateArpeggioChannels(_inPtr, shimmerCount, hueShiftCount, nightGate, intensityScale, _outPtr);

    const outView = new Float32Array((mem as unknown as { buffer: ArrayBuffer }).buffer || mem, _outPtr, 2);
    outResult[0] = outView[0];
    outResult[1] = outView[1];

    return true;
}

/**
 * Hot-path entry: prefer AS when enabled, else TS fallback.
 * @returns true if the native path wrote outResult
 */
export function accumulateArpeggioChannels(
    volumes: Float32Array,
    shimmerCount: number,
    hueShiftCount: number,
    nightGate: number,
    intensityScale: number,
    outResult: Float32Array
): boolean {
    if (isNativeMusicAccumEnabled()) {
        if (
            accumulateArpeggioChannelsNative(
                volumes,
                shimmerCount,
                hueShiftCount,
                nightGate,
                intensityScale,
                outResult
            )
        ) {
            return true;
        }
    }
    accumulateArpeggioChannelsTS(
        volumes,
        shimmerCount,
        hueShiftCount,
        nightGate,
        intensityScale,
        outResult
    );
    return false;
}
