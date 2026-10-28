// assembly/particles.ts
import { lerp } from './math';

// Constants for strides
const STRIDE_F32 = 4;

// Math.random() is available in AssemblyScript
// but we might want a seeded random if we want determinism,
// for now standard random is fine as it maps to JS Math.random

// =============================================================================
// BATCH PARTICLE UPDATES
// =============================================================================

/**
 * Update particle positions in batch with velocity and gravity
 * Layout per particle: [x, y, z, vx, vy, vz] = 6 floats
 * Updates positions in-place based on velocity and applies gravity to velocity
 * 
 * @param positionsPtr - Pointer to particle data array [x, y, z, vx, vy, vz, ...]
 * @param count - Number of particles to update
 * @param dt - Delta time in seconds
 * @param gravity - Gravity acceleration (negative for downward)
 */
export function updateParticles(
  positionsPtr: usize,
  count: i32,
  dt: f32,
  gravity: f32
): void {
  if (count <= 0 || positionsPtr == 0) return;

  const clampedDt = Mathf.max(0.0, dt);

  for (let i: i32 = 0; i < count; i++) {
    const base = positionsPtr + <usize>(i * 6 * STRIDE_F32);
    
    // Load position
    let x = load<f32>(base);
    let y = load<f32>(base + STRIDE_F32);
    let z = load<f32>(base + 2 * STRIDE_F32);
    
    // Load velocity
    let vx = load<f32>(base + 3 * STRIDE_F32);
    let vy = load<f32>(base + 4 * STRIDE_F32);
    let vz = load<f32>(base + 5 * STRIDE_F32);
    
    // Update velocity with gravity
    vy += gravity * clampedDt;
    
    // Update position
    x += vx * clampedDt;
    y += vy * clampedDt;
    z += vz * clampedDt;
    
    // Store updated values
    store<f32>(base, x);
    store<f32>(base + STRIDE_F32, y);
    store<f32>(base + 2 * STRIDE_F32, z);
    store<f32>(base + 3 * STRIDE_F32, vx);
    store<f32>(base + 4 * STRIDE_F32, vy);
    store<f32>(base + 5 * STRIDE_F32, vz);
  }
}

// =============================================================================
// PARTICLE SPAWN OPERATIONS
// =============================================================================

/**
 * Spawn particles in a burst pattern (explosion/dispersal effect)
 * Layout per particle output: [x, y, z, vx, vy, vz] = 6 floats
 * Particles spawn at center and burst outward with equal energy distribution
 * 
 * @param outputPtr - Pointer to output array for particle data
 * @param count - Number of particles to spawn
 * @param centerX - Burst center X position
 * @param centerY - Burst center Y position
 * @param centerZ - Burst center Z position
 * @param speed - Initial burst speed magnitude
 * @param time - Time value for deterministic randomization
 */
export function spawnBurst(
  outputPtr: usize,
  count: i32,
  centerX: f32, centerY: f32, centerZ: f32,
  speed: f32,
  time: f32
): void {
  if (count <= 0 || outputPtr == 0) return;

  for (let i: i32 = 0; i < count; i++) {
    const base = outputPtr + <usize>(i * 6 * STRIDE_F32);
    
    // Deterministic "random" based on index and time
    const seed = time * 1000.0 + <f32>i * 1.618;
    
    // Fibonacci sphere distribution for even coverage
    const phi = Mathf.acos(1.0 - 2.0 * (<f32>i + 0.5) / <f32>count);
    const theta = <f32>(<f32>Math.PI * (1.0 + Mathf.sqrt(5.0)) * <f32>i);
    
    // Add time-based variation
    const variation = Mathf.sin(seed * 0.1) * 0.2;
    const finalPhi = phi + variation;
    
    // Calculate direction
    const dx = <f32>(Mathf.sin(finalPhi) * Mathf.cos(theta));
    const dy = <f32>(Mathf.cos(finalPhi));
    const dz = <f32>(Mathf.sin(finalPhi) * Mathf.sin(theta));
    
    // Add random speed variation per particle
    const speedVariation = 0.8 + Mathf.abs(Mathf.sin(seed * 12.9898)) * 0.4;
    const finalSpeed = speed * speedVariation;
    
    // Store position (at center)
    store<f32>(base, centerX);
    store<f32>(base + STRIDE_F32, centerY);
    store<f32>(base + 2 * STRIDE_F32, centerZ);
    
    // Store velocity (burst direction * speed)
    store<f32>(base + 3 * STRIDE_F32, <f32>(dx * finalSpeed));
    store<f32>(base + 4 * STRIDE_F32, <f32>(dy * finalSpeed));
    store<f32>(base + 5 * STRIDE_F32, <f32>(dz * finalSpeed));
  }
}
