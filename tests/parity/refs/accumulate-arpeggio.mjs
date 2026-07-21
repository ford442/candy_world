/**
 * Pure TS reference: arpeggio_grove channel volume accumulate + nightGate scale.
 * Faithful copy of MusicReactivitySystem.updateBiomeChannelBindings arpeggio slice:
 *   shimmer = min(sum(shimmerVols)/max(shimmerCount,1), 1) * nightGate * intensityScale
 *   hueShift = min(sum(hueShiftVols)/max(hueShiftCount,1), 1) * nightGate * intensityScale
 *
 * Input volumes are pre-gathered (shimmer channels first, then hueShift) — same packing
 * as assembly/music_reactivity.ts accumulateArpeggioChannels.
 *
 * Allocation-free: writes into caller-provided outResult Float32Array length 2.
 */

/**
 * @param {Float32Array} volumes       packed [shimmer..., hueShift...] length shimmerCount+hueShiftCount
 * @param {number} shimmerCount
 * @param {number} hueShiftCount
 * @param {number} nightGate           0.2 + (1 - dayNightBias) * 0.8
 * @param {number} intensityScale
 * @param {Float32Array} outResult     [shimmer, hueShift]
 */
export function accumulateArpeggioChannelsTS(
  volumes,
  shimmerCount,
  hueShiftCount,
  nightGate,
  intensityScale,
  outResult
) {
  let shimmerAccum = 0.0;
  for (let i = 0; i < shimmerCount; i++) {
    shimmerAccum += volumes[i];
  }

  let hueShiftAccum = 0.0;
  const end = shimmerCount + hueShiftCount;
  for (let i = shimmerCount; i < end; i++) {
    hueShiftAccum += volumes[i];
  }

  // Match AS: divisor is count when > 1, else 1.0 (same as Math.max(count, 1))
  const shimmerDiv = shimmerCount > 1 ? shimmerCount : 1.0;
  let shimmerVal = shimmerAccum / shimmerDiv;
  if (shimmerVal > 1.0) shimmerVal = 1.0;
  outResult[0] = shimmerVal * nightGate * intensityScale;

  const hueShiftDiv = hueShiftCount > 1 ? hueShiftCount : 1.0;
  let hueShiftVal = hueShiftAccum / hueShiftDiv;
  if (hueShiftVal > 1.0) hueShiftVal = 1.0;
  outResult[1] = hueShiftVal * nightGate * intensityScale;
}

/**
 * Compute nightGate from dayNightBias (documented formula from music-reactivity.ts).
 * nightGate: 1.0 at night (bias=0) → 0.2 at full day (bias=1)
 * @param {number} dayNightBias
 * @returns {number}
 */
export function nightGateFromBias(dayNightBias) {
  return 0.2 + (1.0 - dayNightBias) * 0.8;
}
