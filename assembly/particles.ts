// assembly/particles.ts
// WASM-optimized particle system for fireflies

/**
 * Update firefly particle positions with drift animation
 * 
 * Memory layout:
 * - positions: Float32Array (count * 3) - x, y, z positions
 * - phases: Float32Array (count) - phase offset for each particle
 * 
 * @param positionsPtr - Pointer to positions array in shared memory
 * @param phasesPtr - Pointer to phases array in shared memory
 * @param count - Number of particles
 * @param time - Current animation time
 */
export function updateParticles(
  positionsPtr: usize,
  phasesPtr: usize,
  count: i32,
  time: f32
): void {
  const halfArea: f32 = 50.0; // Match original boundary logic (±50)
  
  let posPtr = positionsPtr;
  let phasePtr = phasesPtr;
  
  for (let i = 0; i < count; i++) {
    const phase = load<f32>(phasePtr);
    
    // Calculate drift offsets (matches original algorithm)
    const driftX = Mathf.sin(time * 0.3 + phase) * 0.02;
    const driftY = Mathf.cos(time * 0.5 + phase * 1.3) * 0.01;
    const driftZ = Mathf.sin(time * 0.4 + phase * 0.7) * 0.02;
    
    // Update positions
    let x = load<f32>(posPtr) + driftX;
    let y = load<f32>(posPtr + 4) + driftY;
    let z = load<f32>(posPtr + 8) + driftZ;
    
    // Wrap boundaries (matches original ±50 logic)
    if (x > halfArea) x = -halfArea;
    if (x < -halfArea) x = halfArea;
    if (y < 0.3) y = 0.3;
    if (y > 5.0) y = 5.0;
    if (z > halfArea) z = -halfArea;
    if (z < -halfArea) z = halfArea;
    
    // Store updated positions
    store<f32>(posPtr, x);
    store<f32>(posPtr + 4, y);
    store<f32>(posPtr + 8, z);
    
    // Increment pointers for next particle
    posPtr += 12; // 3 floats * 4 bytes
    phasePtr += 4; // 1 float * 4 bytes
  }
}
