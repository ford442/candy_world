// AssemblyScript Physics & Math Module for Candy World
// Provides optimized WASM functions for compute-intensive operations

// =============================================================================
// MEMORY LAYOUT (all f32, 4 bytes each)
// =============================================================================
// Offset 0-4095:     Object positions [x, y, z, padding, ...] (256 objects max)
// Offset 4096-8191:  Animation data [offset, type, originalY, padding, ...]
// Offset 8192-12287: Output buffer [result1, result2, ...]
// =============================================================================

const POSITION_OFFSET: i32 = 0;
const ANIMATION_OFFSET: i32 = 4096;
const OUTPUT_OFFSET: i32 = 8192;

// =============================================================================
// SIMPLE MATH HELPERS
// =============================================================================

/** Linear interpolation between a and b */
export function lerp(a: f32, b: f32, t: f32): f32 {
  return a + (b - a) * t;
}

/** Clamp value between min and max */
export function clamp(value: f32, minVal: f32, maxVal: f32): f32 {
  return Mathf.max(minVal, Mathf.min(maxVal, value));
}

// =============================================================================
// TERRAIN FUNCTIONS
// =============================================================================

/** Calculate procedural ground height at given x, z coordinates */
export function getGroundHeight(x: f32, z: f32): f32 {
  // Guard against NaN
  if (isNaN(x) || isNaN(z)) return 0.0;

  // Large rolling hills
  const hills = Mathf.sin(x * 0.05) * 2.0 + Mathf.cos(z * 0.05) * 2.0;

  // Smaller detail bumps
  const detail = Mathf.sin(x * 0.2) * 0.3 + Mathf.cos(z * 0.15) * 0.3;

  return hills + detail;
}

// =============================================================================
// AUDIO VISUALIZATION FUNCTIONS
// =============================================================================

/** Convert audio frequency to HSL hue value (0-1) */
export function freqToHue(freq: f32): f32 {
  if (freq < 50.0) return 0.0;

  // Map frequency logarithmically to hue
  // log2(freq / 55.0) gives us octaves above A1
  const logF = Mathf.log2(freq / 55.0);

  // Wrap to 0-1 range
  return (logF * 0.1) % 1.0;
}

// =============================================================================
// COLLISION DETECTION (Enhanced from original)
// =============================================================================

/** Check collision between player and objects stored in memory */
export function checkCollision(
  playerX: f32,
  playerZ: f32,
  playerRadius: f32,
  objectCount: i32
): i32 {
  for (let i = 0; i < objectCount; i++) {
    // Each object: [x, y, z, radius] = 16 bytes
    const ptr = POSITION_OFFSET + i * 16;
    const objX = load<f32>(ptr);
    const objZ = load<f32>(ptr + 8); // Skip Y at +4
    const objR = load<f32>(ptr + 12);

    // Distance squared
    const dx = playerX - objX;
    const dz = playerZ - objZ;
    const distSq = dx * dx + dz * dz;

    const radii = playerRadius + objR;
    if (distSq < radii * radii) {
      return 1; // Collision detected
    }
  }
  return 0; // No collision
}

// =============================================================================
// BATCH PROCESSING - Distance Culling
// =============================================================================

/** 
 * Batch check distances from camera to objects.
 * Writes visibility flags (1.0 or 0.0) to output buffer.
 * Returns count of visible objects.
 */
export function batchDistanceCull(
  cameraX: f32,
  cameraY: f32,
  cameraZ: f32,
  maxDistSq: f32,
  objectCount: i32
): i32 {
  let visibleCount: i32 = 0;

  for (let i = 0; i < objectCount; i++) {
    // Read object position: [x, y, z, padding]
    const ptr = POSITION_OFFSET + i * 16;
    const objX = load<f32>(ptr);
    const objY = load<f32>(ptr + 4);
    const objZ = load<f32>(ptr + 8);

    // Calculate squared distance
    const dx = cameraX - objX;
    const dy = cameraY - objY;
    const dz = cameraZ - objZ;
    const distSq = dx * dx + dy * dy + dz * dz;

    // Write visibility flag to output buffer
    const outPtr = OUTPUT_OFFSET + i * 4;
    if (distSq <= maxDistSq) {
      store<f32>(outPtr, 1.0);
      visibleCount++;
    } else {
      store<f32>(outPtr, 0.0);
    }
  }

  return visibleCount;
}

// =============================================================================
// BATCH PROCESSING - Animation Calculations
// =============================================================================

// Animation type constants
const ANIM_BOUNCE: i32 = 1;
const ANIM_SWAY: i32 = 2;
const ANIM_WOBBLE: i32 = 3;
const ANIM_HOP: i32 = 4;

/**
 * Batch calculate Y-offsets for bounce animations.
 * Reads animation data, writes Y-offsets to output buffer.
 * 
 * Animation data layout per object: [offset, type, originalY, padding] = 16 bytes
 * Output: [yOffset, rotX, rotZ, padding] = 16 bytes per object
 */
export function batchAnimationCalc(
  time: f32,
  intensity: f32,
  kick: f32,
  objectCount: i32
): void {
  for (let i = 0; i < objectCount; i++) {
    // Read animation data
    const animPtr = ANIMATION_OFFSET + i * 16;
    const offset = load<f32>(animPtr);
    const animType = <i32>load<f32>(animPtr + 4);
    const originalY = load<f32>(animPtr + 8);

    // Calculate animated time
    const animTime = time + offset;

    // Output pointer
    const outPtr = OUTPUT_OFFSET + i * 16;

    // Default values
    let yOffset: f32 = 0.0;
    let rotX: f32 = 0.0;
    let rotZ: f32 = 0.0;

    if (animType == ANIM_BOUNCE) {
      yOffset = Mathf.sin(animTime * 3.0) * 0.1 * intensity;
      if (kick > 0.1) yOffset += kick * 0.2;
    }
    else if (animType == ANIM_SWAY) {
      rotZ = Mathf.sin(time + offset) * 0.1 * intensity;
    }
    else if (animType == ANIM_WOBBLE) {
      rotX = Mathf.sin(animTime * 3.0) * 0.15 * intensity;
      rotZ = Mathf.cos(animTime * 3.0) * 0.15 * intensity;
    }
    else if (animType == ANIM_HOP) {
      const hopVal = Mathf.sin(animTime * 4.0);
      const bounce = Mathf.max(0.0, hopVal) * 0.3 * intensity;
      yOffset = bounce;
      if (kick > 0.1) yOffset += kick * 0.15;
    }

    // Store results
    store<f32>(outPtr, yOffset);
    store<f32>(outPtr + 4, rotX);
    store<f32>(outPtr + 8, rotZ);
    store<f32>(outPtr + 12, 0.0); // padding
  }
}

/**
 * Calculate single bounce Y offset (convenience function)
 */
export function calcBounceY(
  time: f32,
  offset: f32,
  intensity: f32,
  kick: f32
): f32 {
  const animTime = time + offset;
  let yOffset = Mathf.sin(animTime * 3.0) * 0.1 * intensity;
  if (kick > 0.1) yOffset += kick * 0.2;
  return yOffset;
}

/**
 * Calculate sway rotation Z
 */
export function calcSwayRotZ(time: f32, offset: f32, intensity: f32): f32 {
  return Mathf.sin(time + offset) * 0.1 * intensity;
}

/**
 * Calculate wobble rotations (returns rotX, rotZ packed)
 * Use getWobbleX/getWobbleZ to extract values
 */
let wobbleResultX: f32 = 0.0;
let wobbleResultZ: f32 = 0.0;

export function calcWobble(time: f32, offset: f32, intensity: f32): void {
  const animTime = time + offset;
  wobbleResultX = Mathf.sin(animTime * 3.0) * 0.15 * intensity;
  wobbleResultZ = Mathf.cos(animTime * 3.0) * 0.15 * intensity;
}

export function getWobbleX(): f32 { return wobbleResultX; }
export function getWobbleZ(): f32 { return wobbleResultZ; }
