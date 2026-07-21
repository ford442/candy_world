import { wasmInstance, getWasmMemory } from './wasm-loader-core.ts';
import type { WasmExports } from './wasm-loader-core.ts';

let _inPtr = 0;
let _outPtr = 0;
let _capacity = 0;

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
