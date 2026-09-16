// Pure atmosphere-reactivity math — no TSL/uniform imports, safe to import
// standalone under Node (unlike atmosphere-reactivity.ts, which pulls in
// foliage/sky.ts and is part of the uTwilight import cycle).

/** Exponential approach toward `target` at rate `k`, frame-rate independent. */
export function smoothTowards(current: number, target: number, k: number, deltaTime: number): number {
    return current + (target - current) * (1.0 - Math.exp(-k * deltaTime));
}

/** Normalized [0,1] bass/kick energy averaged across the configured bloom channels. */
export function computeBassNorm(
    channels: ReadonlyArray<{ volume: number }> | undefined,
    bloomChannels: readonly number[]
): number {
    if (!channels || bloomChannels.length === 0) return 0;
    let accum = 0;
    for (let i = 0; i < bloomChannels.length; i++) {
        const idx = bloomChannels[i];
        if (idx < channels.length) accum += channels[idx].volume;
    }
    return Math.min(1.0, accum / bloomChannels.length);
}

/** Bloom strength target: rest→peak on crescendo, attenuated by day/night gate, plus beat spike. */
export function computeBloomTarget(
    bassNorm: number,
    rest: number,
    peak: number,
    nightGate: number,
    beatSpike: number
): number {
    const bloomBase = rest + (peak - rest) * bassNorm * nightGate;
    return bloomBase + beatSpike;
}

/** Crescendo fog density target, capped at `fogMax`, with optional weather boost stacked under the cap. */
export function computeFogTarget(
    channels: ReadonlyArray<{ volume: number }> | undefined,
    fogScale: number,
    fogMax: number,
    weatherFogBoost = 0
): number {
    let mixTarget = 0;
    if (channels && channels.length > 0) {
        let total = 0;
        for (let i = 0; i < channels.length; i++) total += channels[i].volume;
        const averageVolume = total / channels.length;
        mixTarget = Math.min(fogMax, averageVolume * fogScale);
    }
    if (weatherFogBoost > 0) {
        mixTarget = Math.min(fogMax, mixTarget + weatherFogBoost * 0.35);
    }
    return mixTarget;
}

/** 0.35 at full day → 1.0 at full night. */
export function computeNightGate(dayNightBias: number): number {
    return 0.35 + (1.0 - dayNightBias) * 0.65;
}

/** Decays a beat-pulse spike toward zero, snapping to exactly 0 below the noise floor. */
export function decayBeatSpike(spike: number, decayRate: number, deltaTime: number): number {
    const beatDecay = 1.0 - Math.exp(-decayRate * deltaTime);
    const next = spike - spike * beatDecay;
    return next < 0.001 ? 0 : next;
}

/** Shaft opacity from melody energy, clamped to the configured peak. */
export function computeMelodyShaft(smoothedMelodyEnergy: number, shaftPeak: number): number {
    return Math.min(shaftPeak, smoothedMelodyEnergy * shaftPeak);
}
