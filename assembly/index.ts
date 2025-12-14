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

// =============================================================================
// BATCH PROCESSING - Mushroom Spawn Candidate Generator
// =============================================================================

/**
 * Generate mushroom spawn candidates based on wind and positions
 * Writes candidate positions (x, y, z, colorIndex) into output buffer sequentially
 * Returns the number of candidates written
 */
export function batchMushroomSpawnCandidates(
  time: f32,
  windX: f32,
  windZ: f32,
  windSpeed: f32,
  objectCount: i32,
  spawnThreshold: f32,
  minDistance: f32,
  maxDistance: f32
): i32 {
  let candidateCount: i32 = 0;

  // Limit number of candidates to avoid overflow in output buffer
  const MAX_CANDIDATES: i32 = 128;

  for (let i = 0; i < objectCount; i++) {
    const ptr = POSITION_OFFSET + i * 16;
    const objX = load<f32>(ptr);
    const objY = load<f32>(ptr + 4);
    const objZ = load<f32>(ptr + 8);
    const objR = load<f32>(ptr + 12);

    // Read colorIndex from animation data padding (we'll store colorIndex as animData[idx+3])
    const animPtr = ANIMATION_OFFSET + i * 16;
    const colorIndex = <i32>load<f32>(animPtr + 12);

    // Pseudo-random values derived from time and index
    // Pseudo-random values derived from time and index (AssemblyScript lacks fract in Mathf)
    const seed = Mathf.abs(time * <f32>1000.0 + <f32>i);
    const r1 = Mathf.sin(seed * <f32>12.9898) * <f32>43758.5453;
    const r2 = Mathf.sin((seed + <f32>1.2345) * <f32>78.233) * <f32>43758.5453;
    const rand1 = r1 - Mathf.floor(r1);
    const rand2 = r2 - Mathf.floor(r2);

    // Weight selection: certain color indices are more likely to travel
    let colorWeight: f32 = 0.005;
    if (colorIndex >= 0 && colorIndex <= 3) colorWeight = 0.02;
    else if (colorIndex == 4) colorWeight = 0.01;

    const spawnProb = windSpeed * colorWeight;
    if (rand1 > (spawnProb * spawnThreshold)) continue;

    // Distance and jitter
    const dist = minDistance + rand2 * (maxDistance - minDistance);
    const jitterX = (rand2 - 0.5) * 2.0; // -1 .. 1
    const jitterZ = (rand1 - 0.5) * 2.0;

    const nx = objX + windX * dist + jitterX;
    const nz = objZ + windZ * dist + jitterZ;

    // Get ground height via getGroundHeight
    const ny = getGroundHeight(nx, nz);
    // If below threshold (e.g., water or invalid), skip
    if (ny < -0.5) continue;

    // Collision check: ensure it's not too close to other objects
    let collides = false;
    for (let j = 0; j < objectCount; j++) {
      if (j == i) continue;
      const optr = POSITION_OFFSET + j * 16;
      const ox = load<f32>(optr);
      const oz = load<f32>(optr + 8);
      const orad = load<f32>(optr + 12);
      const dx = nx - ox;
      const dz = nz - oz;
      const distSq = dx * dx + dz * dz;
      if (distSq < (orad + objR) * (orad + objR)) { collides = true; break; }
    }
    if (collides) continue;

    // Write candidate to output buffer at index candidateCount
    if (candidateCount >= MAX_CANDIDATES) break;
    const outPtr = OUTPUT_OFFSET + candidateCount * 16;
    store<f32>(outPtr, <f32>nx);
    store<f32>(outPtr + 4, <f32>ny);
    store<f32>(outPtr + 8, <f32>nz);
    store<f32>(outPtr + 12, <f32>colorIndex);
    candidateCount++;
  }

  return candidateCount;
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

// =============================================================================
// ADVANCED ANIMATION FUNCTIONS (foliage.js animations)
// =============================================================================

/**
 * Speaker Pulse animation (Subwoofer Lotus)
 * Returns values via getter functions
 */
let speakerYOffset: f32 = 0.0;
let speakerScaleX: f32 = 1.0;
let speakerScaleY: f32 = 1.0;
let speakerScaleZ: f32 = 1.0;

export function calcSpeakerPulse(time: f32, offset: f32, kick: f32): void {
  speakerYOffset = Mathf.sin(time + offset) * 0.2;
  const pump = kick * 0.5;
  speakerScaleX = 1.0 + pump * 0.2;
  speakerScaleY = 1.0 - pump * 0.5;
  speakerScaleZ = 1.0 + pump * 0.2;
}

export function getSpeakerYOffset(): f32 { return speakerYOffset; }
export function getSpeakerScaleX(): f32 { return speakerScaleX; }
export function getSpeakerScaleY(): f32 { return speakerScaleY; }
export function getSpeakerScaleZ(): f32 { return speakerScaleZ; }

/**
 * Accordion Stretch animation (Accordion Palm)
 */
let accordionStretchY: f32 = 1.0;
let accordionWidthXZ: f32 = 1.0;

export function calcAccordionStretch(animTime: f32, offset: f32, intensity: f32): void {
  const rawStretch = Mathf.sin(animTime * 10.0 + offset);
  accordionStretchY = 1.0 + Mathf.max(0.0, rawStretch) * 0.3 * intensity;
  accordionWidthXZ = 1.0 / Mathf.sqrt(accordionStretchY);
}

export function getAccordionStretchY(): f32 { return accordionStretchY; }
export function getAccordionWidthXZ(): f32 { return accordionWidthXZ; }

/**
 * Fiber Whip animation (Willow branches)
 */
let fiberBaseRotY: f32 = 0.0;
let fiberBranchRotZ: f32 = 0.0;

export function calcFiberWhip(time: f32, offset: f32, leadVol: f32, isActive: i32, branchIndex: i32): void {
  fiberBaseRotY = Mathf.sin(time * 0.5 + offset) * 0.1;
  const whip = leadVol * 2.0;
  const childOffset = <f32>branchIndex * 0.5;
  fiberBranchRotZ = 0.785398 + Mathf.sin(time * 2.0 + childOffset) * 0.1; // PI/4
  if (isActive != 0) {
    fiberBranchRotZ += Mathf.sin(time * 10.0 + childOffset) * whip;
  }
}

export function getFiberBaseRotY(): f32 { return fiberBaseRotY; }
export function getFiberBranchRotZ(): f32 { return fiberBranchRotZ; }

/**
 * Hop animation with squash/stretch
 */
export function calcHopY(time: f32, offset: f32, intensity: f32, kick: f32): f32 {
  const animTime = time + offset;
  const hopVal = Mathf.sin(animTime * 4.0);
  let bounce = Mathf.max(0.0, hopVal) * 0.3 * intensity;
  if (kick > 0.1) bounce += kick * 0.15;
  return bounce;
}

/**
 * Shiver animation (small rapid vibration)
 */
let shiverRotX: f32 = 0.0;
let shiverRotZ: f32 = 0.0;

export function calcShiver(time: f32, offset: f32, intensity: f32): void {
  const animTime = time + offset;
  shiverRotX = Mathf.sin(animTime * 20.0) * 0.02 * intensity;
  shiverRotZ = Mathf.cos(animTime * 20.0) * 0.02 * intensity;
}

export function getShiverRotX(): f32 { return shiverRotX; }
export function getShiverRotZ(): f32 { return shiverRotZ; }

/**
 * Spiral Wave animation
 */
let spiralRotY: f32 = 0.0;
let spiralYOffset: f32 = 0.0;
let spiralScale: f32 = 1.0;

export function calcSpiralWave(time: f32, offset: f32, intensity: f32, groove: f32): void {
  const animTime = time + offset;
  spiralRotY = Mathf.sin(animTime * 2.0) * 0.2 * intensity;
  spiralYOffset = Mathf.sin(animTime * 3.0) * 0.1 * (1.0 + groove);
  spiralScale = 1.0 + Mathf.sin(animTime * 4.0) * 0.05 * intensity;
}

export function getSpiralRotY(): f32 { return spiralRotY; }
export function getSpiralYOffset(): f32 { return spiralYOffset; }
export function getSpiralScale(): f32 { return spiralScale; }

/**
 * Prism Rose animation
 */
let prismUnfurl: f32 = 0.0;
let prismSpin: f32 = 0.0;
let prismPulse: f32 = 1.0;
let prismHue: f32 = 0.0;

export function calcPrismRose(time: f32, offset: f32, kick: f32, groove: f32, isActive: i32): void {
  const animTime = time + offset;
  const intensity: f32 = isActive != 0 ? (1.0 + groove * 3.0) : 0.3;
  prismUnfurl = Mathf.sin(animTime * 2.0) * 0.1 * intensity;
  prismSpin = animTime * 0.5 + groove * 2.0;
  prismPulse = 1.0 + kick * 0.3;
  prismHue = (animTime * 0.1) % 1.0;
}

export function getPrismUnfurl(): f32 { return prismUnfurl; }
export function getPrismSpin(): f32 { return prismSpin; }
export function getPrismPulse(): f32 { return prismPulse; }
export function getPrismHue(): f32 { return prismHue; }

// =============================================================================
// COLOR FUNCTIONS
// =============================================================================

/** Lerp between two RGB colors (packed as u32: 0xRRGGBB) */
export function lerpColor(color1: u32, color2: u32, t: f32): u32 {
  const r1 = <f32>((color1 >> 16) & 0xFF);
  const g1 = <f32>((color1 >> 8) & 0xFF);
  const b1 = <f32>(color1 & 0xFF);
  const r2 = <f32>((color2 >> 16) & 0xFF);
  const g2 = <f32>((color2 >> 8) & 0xFF);
  const b2 = <f32>(color2 & 0xFF);
  const r = <u32>(r1 + (r2 - r1) * t);
  const g = <u32>(g1 + (g2 - g1) * t);
  const b = <u32>(b1 + (b2 - b1) * t);
  return (r << 16) | (g << 8) | b;
}

// =============================================================================
// PARTICLE / RAIN FUNCTIONS
// =============================================================================

/** Calculate rain droplet Y position (cycles back to top) */
export function calcRainDropY(startY: f32, time: f32, speed: f32, cycleHeight: f32): f32 {
  const totalDrop = time * speed;
  const cycled = totalDrop % cycleHeight;
  return startY - cycled;
}

/** Calculate floating particle position */
let particleX: f32 = 0.0;
let particleY: f32 = 0.0;
let particleZ: f32 = 0.0;

export function calcFloatingParticle(baseX: f32, baseY: f32, baseZ: f32, time: f32, offset: f32, amplitude: f32): void {
  const t = time + offset;
  particleX = baseX + Mathf.sin(t * 0.5) * amplitude;
  particleY = baseY + Mathf.sin(t * 0.7) * amplitude * 0.5;
  particleZ = baseZ + Mathf.cos(t * 0.6) * amplitude;
}

export function getParticleX(): f32 { return particleX; }
export function getParticleY(): f32 { return particleY; }
export function getParticleZ(): f32 { return particleZ; }
