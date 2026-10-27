with open('src/utils/wasm-batch-animation.ts', 'r') as f:
    content = f.read()

new_func = """
let _lodFactorsCapacity = 0;
let _lodFactorsPtrPos = 0;
let _lodFactorsPtrSmoothed = 0;
let _lodFactorsPtrStats = 0;

export function batchUpdateLodFactors_c(
    matrices: Float32Array,
    smoothed: Float32Array,
    count: number,
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    heroMax: number,
    midMax: number,
    blendWidth: number,
    farCullSq: number,
    blendT: number,
    statsOut: Int32Array
): void {
    const f = getNativeFunc('batchUpdateLodFactors_c');
    const emsc = getEmscriptenInstance();
    if (!f || !emscriptenMemory || !emsc || !emsc._malloc || !emsc._free) {
        return;
    }

    if (count > _lodFactorsCapacity) {
        if (_lodFactorsPtrPos) emsc._free(_lodFactorsPtrPos);
        if (_lodFactorsPtrSmoothed) emsc._free(_lodFactorsPtrSmoothed);
        if (_lodFactorsPtrStats) emsc._free(_lodFactorsPtrStats);

        _lodFactorsCapacity = Math.max(count * 2, 256);
        _lodFactorsPtrPos = emsc._malloc(_lodFactorsCapacity * 16 * 4);
        _lodFactorsPtrSmoothed = emsc._malloc(_lodFactorsCapacity * 4);
        _lodFactorsPtrStats = emsc._malloc(6 * 4);
    }

    if (!_lodFactorsPtrPos || !_lodFactorsPtrSmoothed || !_lodFactorsPtrStats) return;

    const memoryBuffer = (emscriptenMemory as any).buffer || emscriptenMemory;
    let heapF32 = _cachedHeapF32;
    if (!heapF32 || heapF32.buffer !== memoryBuffer || heapF32.length === 0) {
        heapF32 = _cachedHeapF32 = new Float32Array(memoryBuffer);
    }

    const heapI32 = new Int32Array(memoryBuffer);

    heapF32.set(matrices.subarray(0, count * 16), _lodFactorsPtrPos >> 2);
    heapF32.set(smoothed.subarray(0, count), _lodFactorsPtrSmoothed >> 2);

    f(
        _lodFactorsPtrPos,
        _lodFactorsPtrSmoothed,
        count,
        cameraX,
        cameraY,
        cameraZ,
        heroMax,
        midMax,
        blendWidth,
        farCullSq,
        blendT,
        _lodFactorsPtrStats
    );

    smoothed.set(heapF32.subarray(_lodFactorsPtrSmoothed >> 2, (_lodFactorsPtrSmoothed >> 2) + count));
    statsOut.set(heapI32.subarray(_lodFactorsPtrStats >> 2, (_lodFactorsPtrStats >> 2) + 6));
}
"""

content = content.replace("export function batchUpdateLODMatrices_c(", new_func + "\nexport function batchUpdateLODMatrices_c(")
with open('src/utils/wasm-batch-animation.ts', 'w') as f:
    f.write(content)
