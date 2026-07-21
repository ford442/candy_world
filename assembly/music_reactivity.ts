/**
 * @file music_reactivity.ts
 * @brief Batch processing for music reactivity (AssemblyScript)
 */

/**
 * Accumulate arpeggio_grove shimmer + hueShift.
 * volumesPtr: f32[] of length shimmerCount + hueShiftCount (packed: shimmer first, then hueShift)
 * outPtr:     f32[2] -> [shimmer, hueShift] already scaled by nightGate * intensityScale
 */
export function accumulateArpeggioChannels(
    volumesPtr: usize,
    shimmerCount: i32,
    hueShiftCount: i32,
    nightGate: f32,
    intensityScale: f32,
    outPtr: usize
): void {
    let shimmerAccum: f32 = 0.0;
    let i: i32 = 0;

    // Accumulate Shimmer
    for (; i < shimmerCount; i++) {
        shimmerAccum += load<f32>(volumesPtr + (<usize>i * 4));
    }

    // Accumulate HueShift
    let hueShiftAccum: f32 = 0.0;
    let end: i32 = shimmerCount + hueShiftCount;
    for (; i < end; i++) {
        hueShiftAccum += load<f32>(volumesPtr + (<usize>i * 4));
    }

    // Process Shimmer Out
    let shimmerDiv: f32 = shimmerCount > 1 ? <f32>shimmerCount : 1.0;
    let shimmerVal: f32 = shimmerAccum / shimmerDiv;
    if (shimmerVal > 1.0) shimmerVal = 1.0;
    store<f32>(outPtr, shimmerVal * nightGate * intensityScale);

    // Process HueShift Out
    let hueShiftDiv: f32 = hueShiftCount > 1 ? <f32>hueShiftCount : 1.0;
    let hueShiftVal: f32 = hueShiftAccum / hueShiftDiv;
    if (hueShiftVal > 1.0) hueShiftVal = 1.0;
    store<f32>(outPtr + 4, hueShiftVal * nightGate * intensityScale);
}
