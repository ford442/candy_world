
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

export function computeSpiralWave(count: i32, time: f32, offsets: usize, intensities: usize, childCount: i32, outRotY: usize): void {
    // Skipping for now
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

/**
 * Batch growth calculation for plants
 * Updates all scales in a single batch operation
 * 
 * Data layout per plant (7 floats = 28 bytes):
 *   [0] currentScale
 *   [1] initialScale
 *   [2] maxScale
 *   [3] minScale
 *   [4] growthRate (can be negative for shrink)
 *   [5] outputScale (written back)
 *   [6] changed flag (1.0 if changed, 0.0 if not) - written back
 */
export function batchGrowth(
  dataPtr: usize,
  count: i32
): void {
  for (let i = 0; i < count; i++) {
    const base = dataPtr + (<usize>i * 28); // 7 floats * 4 bytes
    
    const currentScale = load<f32>(base);
    const initialScale = load<f32>(base + 4);
    const maxScale = load<f32>(base + 8);
    const minScale = load<f32>(base + 12);
    const growthRate = load<f32>(base + 16);
    
    let nextScale = currentScale + growthRate;
    let changed: f32 = 0.0;
    
    // Apply limits based on growth direction
    if (growthRate > 0.0) {
      // Growing - cap at max
      if (nextScale > maxScale) {
        nextScale = maxScale;
      }
    } else {
      // Shrinking - floor at min
      if (nextScale < minScale) {
        nextScale = minScale;
      }
    }
    
    // Check if scale actually changed (threshold 0.0001)
    const diff = nextScale - currentScale;
    if (diff < -0.0001 || diff > 0.0001) {
      changed = 1.0;
    }
    
    // Write outputs
    store<f32>(base + 20, nextScale);     // outputScale
    store<f32>(base + 24, changed);        // changed flag
  }
}

/**
 * Batch bloom calculation for flowers
 * Similar to batchGrowth but with bloom-specific logic
 * 
 * Data layout per flower (6 floats = 24 bytes):
 *   [0] currentScale
 *   [1] maxBloom
 *   [2] bloomRate
 *   [3] outputScale
 *   [4] changed flag
 *   [5] padding
 */
export function batchBloom(
  dataPtr: usize,
  count: i32
): void {
  for (let i = 0; i < count; i++) {
    const base = dataPtr + (<usize>i * 24); // 6 floats * 4 bytes
    
    const currentScale = load<f32>(base);
    const maxBloom = load<f32>(base + 4);
    const bloomRate = load<f32>(base + 8);
    
    let nextScale = currentScale;
    let changed: f32 = 0.0;
    
    // Only bloom if under max
    if (currentScale < maxBloom) {
      nextScale = currentScale + bloomRate;
      if (nextScale > maxBloom) {
        nextScale = maxBloom;
      }
      changed = 1.0;
    }
    
    // Write outputs
    store<f32>(base + 12, nextScale);     // outputScale
    store<f32>(base + 16, changed);        // changed flag
  }
}

/**
 * Batch scale animation calculation (for scale restoration after bounce)
 * Efficiently calculates new scale values for multiple objects
 * 
 * Data layout per object (6 floats = 24 bytes):
 *   [0] currentScaleX
 *   [1] currentScaleY  
 *   [2] currentScaleZ
 *   [3] targetScale
 *   [4] lerpFactor
 *   [5+][0] outputScaleX (at base + 24)
 *   [5+][1] outputScaleY (at base + 28)
 *   [5+][2] outputScaleZ (at base + 32)
 *   [5+][3] completed flag (at base + 36)
 */
export function batchScaleAnimation(
  dataPtr: usize,
  count: i32
): void {
  const SCALE_EPSILON: f32 = 0.0001;
  
  for (let i = 0; i < count; i++) {
    const base = dataPtr + (<usize>i * 40); // 10 floats per object
    
    const curX = load<f32>(base);
    const curY = load<f32>(base + 4);
    const curZ = load<f32>(base + 8);
    const target = load<f32>(base + 12);
    const lerpT = load<f32>(base + 16);
    
    // Lerp each axis
    const newX = lerp(curX, target, lerpT);
    const newY = lerp(curY, target, lerpT);
    const newZ = lerp(curZ, target, lerpT);
    
    // Check if animation is complete (all close to target)
    const diffX = Mathf.abs(newX - target);
    const diffY = Mathf.abs(newY - target);
    const diffZ = Mathf.abs(newZ - target);
    const completed = (diffX < SCALE_EPSILON && diffY < SCALE_EPSILON && diffZ < SCALE_EPSILON) ? 1.0 : 0.0;
    
    // Write outputs
    store<f32>(base + 20, newX);
    store<f32>(base + 24, newY);
    store<f32>(base + 28, newZ);
    store<f32>(base + 32, <f32>completed);
  }
}
