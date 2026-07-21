/**
 * @file wasm-batcher-instance.ts
 * @brief Wrapper for instanced-batcher pose → matrix/color writes (#1358)
 *
 * Native: emscripten/batcher_instance.cpp → batchWriteInstancePose_c
 * Fallback: allocation-free TypeScript loop (same math as arpeggio-batcher).
 *
 * When candy_native is unavailable, isEmscriptenReady() is false and the TS
 * path runs — matching the runtime JS fallback contract.
 */

import {
    getEmscriptenInstance,
    emscriptenMemory,
    getNativeFunc,
    isEmscriptenReady,
} from './wasm-loader-core.ts';

// Scratch WASM heap pointers (grow on demand; never freed mid-session)
let _ptrPos = 0;
let _ptrQuat = 0;
let _ptrScale = 0;
let _ptrColorIn = 0;
let _ptrMat = 0;
let _ptrColorOut = 0;
let _maxCount = 0;

function ensureHeap(count: number, needColors: boolean): boolean {
    const em = getEmscriptenInstance();
    if (!em?._malloc || !em._free) return false;

    const colorsReady = !needColors || (_ptrColorIn !== 0 && _ptrColorOut !== 0);
    if (_ptrPos && _maxCount >= count && colorsReady) return true;

    if (_ptrPos) {
        em._free(_ptrPos);
        em._free(_ptrQuat);
        em._free(_ptrScale);
        em._free(_ptrMat);
        if (_ptrColorIn) em._free(_ptrColorIn);
        if (_ptrColorOut) em._free(_ptrColorOut);
        _ptrColorIn = 0;
        _ptrColorOut = 0;
    }

    _maxCount = Math.max(count, _maxCount * 2 || 64);
    _ptrPos = em._malloc(_maxCount * 3 * 4);
    _ptrQuat = em._malloc(_maxCount * 4 * 4);
    _ptrScale = em._malloc(_maxCount * 3 * 4);
    _ptrMat = em._malloc(_maxCount * 16 * 4);
    if (needColors) {
        _ptrColorIn = em._malloc(_maxCount * 3 * 4);
        _ptrColorOut = em._malloc(_maxCount * 3 * 4);
    }

    return !!(
        _ptrPos && _ptrQuat && _ptrScale && _ptrMat &&
        (!needColors || (_ptrColorIn && _ptrColorOut))
    );
}

/**
 * Pure TS fallback — compose TRS matrices (+ optional color write).
 * Exported for parity / microbench (#1351).
 */
export function writeInstancePoseTS(
    positions: Float32Array,
    quaternions: Float32Array,
    scales: Float32Array,
    colorsIn: Float32Array | null,
    matricesOut: Float32Array,
    colorsOut: Float32Array | null,
    colorIntensity: number,
    count: number
): void {
    for (let i = 0; i < count; i++) {
        const qx = quaternions[i * 4 + 0];
        const qy = quaternions[i * 4 + 1];
        const qz = quaternions[i * 4 + 2];
        const qw = quaternions[i * 4 + 3];

        const sx = scales[i * 3 + 0];
        const sy = scales[i * 3 + 1];
        const sz = scales[i * 3 + 2];

        const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
        const xx = qx * x2, xy = qx * y2, xz = qx * z2;
        const yy = qy * y2, yz = qy * z2, zz = qz * z2;
        const wx = qw * x2, wy = qw * y2, wz = qw * z2;

        const mIdx = i * 16;
        matricesOut[mIdx + 0] = (1 - (yy + zz)) * sx;
        matricesOut[mIdx + 1] = (xy + wz) * sx;
        matricesOut[mIdx + 2] = (xz - wy) * sx;
        matricesOut[mIdx + 3] = 0;

        matricesOut[mIdx + 4] = (xy - wz) * sy;
        matricesOut[mIdx + 5] = (1 - (xx + zz)) * sy;
        matricesOut[mIdx + 6] = (yz + wx) * sy;
        matricesOut[mIdx + 7] = 0;

        matricesOut[mIdx + 8] = (xz + wy) * sz;
        matricesOut[mIdx + 9] = (yz - wx) * sz;
        matricesOut[mIdx + 10] = (1 - (xx + yy)) * sz;
        matricesOut[mIdx + 11] = 0;

        matricesOut[mIdx + 12] = positions[i * 3 + 0];
        matricesOut[mIdx + 13] = positions[i * 3 + 1];
        matricesOut[mIdx + 14] = positions[i * 3 + 2];
        matricesOut[mIdx + 15] = 1;

        if (colorsIn && colorsOut) {
            const c = i * 3;
            colorsOut[c] = colorsIn[c] * colorIntensity;
            colorsOut[c + 1] = colorsIn[c + 1] * colorIntensity;
            colorsOut[c + 2] = colorsIn[c + 2] * colorIntensity;
        }
    }
}

/**
 * Write instance matrices (and optional colors) from packed pose SoA.
 * Uses C++ when ready; otherwise TS fallback. Always writes into the
 * caller-provided Float32Array views (typically InstancedMesh buffers).
 *
 * @returns true if the native path ran, false if TS fallback ran
 */
export function writeInstancePose(
    positions: Float32Array,
    quaternions: Float32Array,
    scales: Float32Array,
    colorsIn: Float32Array | null,
    matricesOut: Float32Array,
    colorsOut: Float32Array | null,
    colorIntensity: number,
    count: number
): boolean {
    if (count <= 0) return false;

    const needColors = !!(colorsIn && colorsOut);
    const f = isEmscriptenReady() ? getNativeFunc('batchWriteInstancePose_c') : null;

    if (f && emscriptenMemory && ensureHeap(count, needColors)) {
        const em = getEmscriptenInstance()!;
        const memoryBuffer = (emscriptenMemory as { buffer?: ArrayBuffer }).buffer || emscriptenMemory;
        const heapF32 = new Float32Array(memoryBuffer as ArrayBuffer);

        heapF32.set(positions.subarray(0, count * 3), _ptrPos >> 2);
        heapF32.set(quaternions.subarray(0, count * 4), _ptrQuat >> 2);
        heapF32.set(scales.subarray(0, count * 3), _ptrScale >> 2);

        let colorInPtr = 0;
        let colorOutPtr = 0;
        if (needColors && colorsIn) {
            heapF32.set(colorsIn.subarray(0, count * 3), _ptrColorIn >> 2);
            colorInPtr = _ptrColorIn;
            colorOutPtr = _ptrColorOut;
        }

        f(
            _ptrPos,
            _ptrQuat,
            _ptrScale,
            colorInPtr,
            _ptrMat,
            colorOutPtr,
            colorIntensity,
            count
        );

        matricesOut.set(heapF32.subarray(_ptrMat >> 2, (_ptrMat >> 2) + count * 16), 0);
        if (needColors && colorsOut) {
            colorsOut.set(heapF32.subarray(_ptrColorOut >> 2, (_ptrColorOut >> 2) + count * 3), 0);
        }
        return true;
    }

    writeInstancePoseTS(
        positions,
        quaternions,
        scales,
        colorsIn,
        matricesOut,
        colorsOut,
        colorIntensity,
        count
    );
    return false;
}

/** True when the dedicated batcher-instance native export is callable. */
export function isBatcherInstanceNativeReady(): boolean {
    return isEmscriptenReady() && !!getNativeFunc('batchWriteInstancePose_c');
}
