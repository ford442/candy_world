
// assembly/foliage.ts

import { lerp, clamp } from "./math";

// =============================================================================
// EXISTING FOLIAGE ANIMATION FUNCTIONS
// =============================================================================

export function computeSway(count: i32, time: f32, offsets: usize, intensities: usize, outRotZ: usize): void {
  for (let i = 0; i < count; i++) {
    let offset = load<f32>(offsets + (<usize>i << 2));
    let intensity = load<f32>(intensities + (<usize>i << 2));

    // foliageObject.rotation.z = Math.sin(time + offset) * 0.11 * intensity;
    let val = Math.sin(time + offset) * 0.11 * intensity;

    store<f32>(outRotZ + (<usize>i << 2), val as f32);
  }
}

export function computeBounce(count: i32, time: f32, originalYs: usize, offsets: usize, intensities: usize, kick: f32, outPosY: usize): void {
  for (let i = 0; i < count; i++) {
    let originalY = load<f32>(originalYs + (<usize>i << 2));
    let offset = load<f32>(offsets + (<usize>i << 2));
    let intensity = load<f32>(intensities + (<usize>i << 2));

    // Restore original logic: kick only applies if > 0.12
    let kickAmt = 0.0;
    if (kick > 0.12) {
       kickAmt = kick * 0.21;
    }

    // foliageObject.position.y = y + Math.sin(animTime * 3 + offset) * 0.12 * intensity;
    let bounce = Math.sin(time * 3.0 + offset) * 0.12 * intensity;
    let val = originalY + bounce + kickAmt;

    store<f32>(outPosY + (<usize>i << 2), val as f32);
  }
}

export function computeWobble(count: i32, time: f32, offsets: usize, intensities: usize, wobbleBoosts: usize, outRotX: usize, outRotZ: usize): void {
  for (let i = 0; i < count; i++) {
    let offset = load<f32>(offsets + (<usize>i << 2));
    let intensity = load<f32>(intensities + (<usize>i << 2));
    let boost = load<f32>(wobbleBoosts + (<usize>i << 2));

    // rotX = sin(time * 3 + offset) * 0.15 * intensity * (1 + boost)
    // rotZ = cos(time * 3 + offset) * 0.16 * intensity * (1 + boost)

    let factor = intensity * (1.0 + boost);
    let valX = Math.sin(time * 3.0 + offset) * 0.15 * factor;
    let valZ = Math.cos(time * 3.0 + offset) * 0.16 * factor;

    store<f32>(outRotX + (<usize>i << 2), valX as f32);
    store<f32>(outRotZ + (<usize>i << 2), valZ as f32);
  }
}

export function computeGentleSway(count: i32, time: f32, offsets: usize, intensities: usize, outRotZ: usize): void {
  for (let i = 0; i < count; i++) {
    let offset = load<f32>(offsets + (<usize>i << 2));
    let intensity = load<f32>(intensities + (<usize>i << 2));

    // rotZ = sin(time * 0.5 + offset) * 0.05 * intensity
    let val = Math.sin(time * 0.5 + offset) * 0.05 * intensity;

    store<f32>(outRotZ + (<usize>i << 2), val as f32);
  }
}

export function computeHop(count: i32, time: f32, originalYs: usize, offsets: usize, intensities: usize, kick: f32, outPosY: usize): void {
  for (let i = 0; i < count; i++) {
     let originalY = load<f32>(originalYs + (<usize>i << 2));
     let offset = load<f32>(offsets + (<usize>i << 2));
     let intensity = load<f32>(intensities + (<usize>i << 2));

     // Restore original logic: kick only applies if > 0.1
     let kickAmt = 0.0;
     if (kick > 0.1) {
        kickAmt = kick * 0.15;
     }

     // hopTime = time * 4 + offset
     // bounce = max(0, sin(hopTime)) * 0.3 * intensity
     let hopTime = time * 4.0 + offset;
     let bounce = Math.sin(hopTime);
     if (bounce < 0) bounce = 0;
     bounce = bounce * 0.3 * intensity;

     let val = originalY + bounce + kickAmt;
     store<f32>(outPosY + (<usize>i << 2), val as f32);
  }
}

// =============================================================================
// NEW HOT-PATH FUNCTIONS (Migrated from TypeScript)
// =============================================================================

/**
 * Calculate median of a float array
 * Used for wobble smoothing calculations
 */
function medianValue(bufPtr: usize, size: i32): f32 {
  if (size <= 0) return 0.0;
  if (size == 1) return load<f32>(bufPtr);
  
  // For small buffers (typical use case: 8-16 elements), use simple sort
  // Allocate temporary array on stack for sorting
  const temp = new StaticArray<f32>(size);
  for (let i = 0; i < size; i++) {
    unchecked(temp[i] = load<f32>(bufPtr + (<usize>i << 2)));
  }
  
  // Simple insertion sort for small arrays
  for (let i = 1; i < size; i++) {
    const key = unchecked(temp[i]);
    let j = i - 1;
    while (j >= 0 && unchecked(temp[j]) > key) {
      unchecked(temp[j + 1] = temp[j]);
      j--;
    }
    unchecked(temp[j + 1] = key);
  }
  
  // Return median
  if (size % 2 == 1) {
    return unchecked(temp[size >> 1]);
  } else {
    const mid = size >> 1;
    return (unchecked(temp[mid - 1]) + unchecked(temp[mid])) * 0.5;
  }
}

/**
 * Smooth wobble calculation for mushrooms
 * @param noteBufferPtr - Pointer to float array of recent note velocities
 * @param bufferSize - Size of the buffer
 * @param currentWobble - Current wobble value
 * @param scale - Scale multiplier for velocity
 * @param maxAmplitude - Maximum wobble amplitude
 * @param minThreshold - Minimum wobble threshold
 * @param smoothingRate - Smoothing rate (higher = faster response)
 * @returns New wobble value
 */
export function smoothWobble(
  noteBufferPtr: usize,
  bufferSize: i32,
  currentWobble: f32,
  scale: f32,
  maxAmplitude: f32,
  minThreshold: f32,
  smoothingRate: f32
): f32 {
  // 1. Calculate median of buffer
  const medianVel = medianValue(noteBufferPtr, bufferSize);
  
  // 2. Scale and clamp to get target
  const scaled = medianVel * scale;
  const clamped = clamp(scaled, minThreshold, maxAmplitude);
  
  // 3. Calculate lerp factor (max 0.25 to prevent jumps)
  const lerpT = <f32>Math.min(0.25, smoothingRate * 0.02);
  
  // 4. Lerp with current value
  return lerp(currentWobble, clamped, lerpT);
}

