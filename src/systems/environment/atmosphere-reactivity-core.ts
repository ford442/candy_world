export function smooth(current: number, target: number, k: number, deltaTime: number): number {
    return current + (target - current) * (1.0 - Math.exp(-k * deltaTime));
}

export function simulateBloomTarget(bassNorm: number, rest: number, peak: number, nightGate: number, beatSpike: number): number {
    const bloomBase = rest + (peak - rest) * bassNorm * nightGate;
    return bloomBase + beatSpike;
}

export function simulateFogTarget(averageVolume: number, scale: number, max: number, weatherFogBoost: number = 0): number {
    let mixTarget = Math.min(max, averageVolume * scale);
    if (weatherFogBoost > 0) {
        mixTarget = Math.min(max, mixTarget + weatherFogBoost * 0.35);
    }
    return mixTarget;
}

export function nightGateFromBias(dayNightBias: number): number {
    return 0.2 + (1.0 - dayNightBias) * 0.8;
}

export function accumulateArpeggioChannels(
    volumes: Float32Array,
    shimmerCount: number,
    hueShiftCount: number,
    nightGate: number,
    intensityScale: number,
    outResult: Float32Array
): void {
    let shimmerAccum = 0.0;
    for (let i = 0; i < shimmerCount; i++) shimmerAccum += volumes[i];
    let hueShiftAccum = 0.0;
    const end = shimmerCount + hueShiftCount;
    for (let i = shimmerCount; i < end; i++) hueShiftAccum += volumes[i];

    const shimmerDiv = shimmerCount > 1 ? shimmerCount : 1.0;
    let shimmerVal = shimmerAccum / shimmerDiv;
    if (shimmerVal > 1.0) shimmerVal = 1.0;
    outResult[0] = shimmerVal * nightGate * intensityScale;

    const hueShiftDiv = hueShiftCount > 1 ? hueShiftCount : 1.0;
    let hueShiftVal = hueShiftAccum / hueShiftDiv;
    if (hueShiftVal > 1.0) hueShiftVal = 1.0;
    outResult[1] = hueShiftVal * nightGate * intensityScale;
}
