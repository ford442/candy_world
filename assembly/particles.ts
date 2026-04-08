// assembly/particles.ts
import { calcRainDropY } from './animation';
import { lerp } from './math';

// Constants for strides
const STRIDE_F32 = 4;

// Math.random() is available in AssemblyScript
// but we might want a seeded random if we want determinism,
// for now standard random is fine as it maps to JS Math.random

// updateRainBatch
// positionsPtr: pointer to Float32Array of positions (x, y, z)
// velocitiesPtr: pointer to Float32Array of velocities
// offsetsPtr: pointer to Float32Array of offsets
// count: number of particles
// time: current time
// bassIntensity: current bass intensity
// weatherState: 0=clear, 1=rain, 2=storm (used for logic if needed, currently unused in math)
// intensity: current weather intensity (0.0 - 1.0)
export function updateRainBatch(
    positionsPtr: usize,
    velocitiesPtr: usize,
    offsetsPtr: usize,
    count: i32,
    time: f32,
    bassIntensity: f32
): void {
    // Defensive guards: invalid counts or pointers are no-ops
    if (count <= 0) return;

    // Validate basic pointer arithmetic to avoid out-of-bounds memory access in wasm
    // Each particle uses 3 floats (x,y,z) => 3 * STRIDE_F32 bytes per particle
    const requiredPosBytes = <usize>count * 3 * <usize>STRIDE_F32;
    const requiredVelBytes = <usize>count * <usize>STRIDE_F32;
    const requiredOffsBytes = <usize>count * <usize>STRIDE_F32;

    // Simple overflow / sanity checks. If pointers are clearly invalid, bail out.
    if (positionsPtr == 0 || velocitiesPtr == 0 || offsetsPtr == 0) return;
    // NOTE: We cannot read the runtime memory size easily here; these checks at least
    // stop obviously invalid inputs and make the function safe for malformed callers.

    for (let i = 0; i < count; i++) {
        // Compute byte offsets and validate small index range before load/store
        const offByte = offsetsPtr + <usize>(i * STRIDE_F32);
        const velByte = velocitiesPtr + <usize>(i * STRIDE_F32);
        const posBase = positionsPtr + <usize>(i * 3 * STRIDE_F32);

        // Basic validation: ensure computed offsets didn't wrap (simple overflow detection)
        // If addition wrapped around, posBase will be less than the original pointer.
        if (offByte == 0 || velByte == 0 || posBase == 0) continue;
        if (offByte < offsetsPtr || velByte < velocitiesPtr || posBase < positionsPtr) continue;
        // Ensure space for x,y,z exists (best-effort check)
        if (posBase + (2 * STRIDE_F32) < posBase) continue;

        // Load offset
        let offsetVal = load<f32>(offByte);

        // Load velocity
        let velocityVal = load<f32>(velByte);

        // Load position Y (index 1)
        let currentY = load<f32>(posBase + STRIDE_F32); // y is at +4 bytes

        let startY = 50.0 + offsetVal;
        let speed = velocityVal * (1.0 + bassIntensity);

        let cycleHeight = 50.0;
        let totalDrop = time * speed;
        let cycled = totalDrop % cycleHeight;
        let newY = startY - cycled;

        store<f32>(posBase + STRIDE_F32, <f32>newY);

        if (newY < 0.0) {
             let rx = (Math.random() - 0.5) * 100.0;
             let rz = (Math.random() - 0.5) * 100.0;
             store<f32>(posBase, <f32>rx);
             store<f32>(posBase + (2 * STRIDE_F32), <f32>rz);
        }
    }
}

// updateMelodicMistBatch
// positionsPtr: pointer to positions
// count: number of particles
// time: current time
// melodyVol: melody volume
export function updateMelodicMistBatch(
    positionsPtr: usize,
    count: i32,
    time: f32,
    melodyVol: f32
): void {
    // Defensive guards
    if (count <= 0) return;
    if (positionsPtr == 0) return;

    for (let i = 0; i < count; i++) {
        const posBase = positionsPtr + <usize>(i * 3 * STRIDE_F32);
        if (posBase == 0) continue;
        if (posBase < positionsPtr) continue;
        if (posBase + (2 * STRIDE_F32) < posBase) continue;

        let offset = <f32>i * 0.1;

        let yVal = 1.0 + Math.sin(time + offset) * Math.max(melodyVol, 0.3) * 2.0;

        // Read current X and Z to add to them
        let currentX = load<f32>(posBase);
        let currentZ = load<f32>(posBase + (2 * STRIDE_F32));

        let dx = Math.sin(time * 0.5 + offset) * 0.01;
        let dz = Math.cos(time * 0.4 + offset) * 0.01;

        store<f32>(posBase, currentX + <f32>dx);
        store<f32>(posBase + STRIDE_F32, <f32>yVal);
        store<f32>(posBase + (2 * STRIDE_F32), currentZ + <f32>dz);
    }
}

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
