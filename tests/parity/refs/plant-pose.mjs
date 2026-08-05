/**
 * TS reference for PlantPoseMachine / gpu-plant-pose.ts WGSL parity.
 */

export function computePlantPoseFrameTS(
  count,
  delta,
  channelIntensity,
  dayNightBias,
  config,
  positions,
  envelopeLevels,
  currentPoses,
  wave = null
) {
  const { attackRate, releaseRate, sustainLevel, dayTarget, nightTarget, triggerThreshold } = config;
  const baseline = nightTarget + (dayTarget - nightTarget) * dayNightBias;
  const envelopePeak = dayTarget * sustainLevel;
  const lerpK = Math.min(1.0, attackRate * delta);

  for (let i = 0; i < count; i++) {
    let triggerValue = channelIntensity;
    if (wave) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const dx = px - wave.originX;
      const dy = py - wave.originY;
      const dz = pz - wave.originZ;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < wave.radiusSq && wave.radiusSq > 0) {
        const progress = 1.0 - distSq / wave.radiusSq;
        triggerValue = Math.min(1.0, progress * 2.0);
      } else {
        triggerValue = 0;
      }
    }

    if (triggerValue > triggerThreshold) {
      envelopeLevels[i] += attackRate * delta;
      if (envelopeLevels[i] > 1.0) envelopeLevels[i] = 1.0;
    } else {
      envelopeLevels[i] -= releaseRate * delta;
      if (envelopeLevels[i] < 0.0) envelopeLevels[i] = 0.0;
    }

    const targetPose = baseline + (envelopePeak - baseline) * envelopeLevels[i];
    currentPoses[i] += (targetPose - currentPoses[i]) * lerpK;
  }
}
