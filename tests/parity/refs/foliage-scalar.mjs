/**
 * TS reference for foliage scalar batches (sway / gentleSway / bounce / hop).
 * Must match `assembly/foliage.ts` and `foliage-gpu-batch.ts` BATCH_SCALAR_WGSL.
 */

export function computeFoliageScalarTS(mode, time, kick, offset, intensity, originalY = 0) {
  if (mode === 'sway') {
    return Math.sin(time + offset) * 0.11 * intensity;
  }
  if (mode === 'gentleSway') {
    return Math.sin(time * 0.5 + offset) * 0.05 * intensity;
  }
  if (mode === 'bounce') {
    let kickAmt = 0;
    if (kick > 0.12) kickAmt = kick * 0.21;
    return originalY + Math.sin(time * 3 + offset) * 0.12 * intensity + kickAmt;
  }
  if (mode === 'hop') {
    let kickAmt = 0;
    if (kick > 0.1) kickAmt = kick * 0.15;
    return originalY + Math.max(0, Math.sin(time * 4 + offset)) * 0.3 * intensity + kickAmt;
  }
  throw new Error(`Unknown mode: ${mode}`);
}
