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
 * @param areaSize - Size of the area bounds (default 100)
 */
export function updateParticles(
  positionsPtr: usize,
  phasesPtr: usize,
  count: i32,
  time: f32,
  areaSize: f32 = 100.0
): void {
  const halfArea = areaSize * 0.5;
  
  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    const posIdx = positionsPtr + (idx << 2); // idx * 4 (f32 size)
    const phaseIdx = phasesPtr + (i << 2);
    
    const phase = load<f32>(phaseIdx);
    
    // Calculate drift offsets
    const driftX = Mathf.sin(time * 0.3 + phase) * 0.02;
    const driftY = Mathf.cos(time * 0.5 + phase * 1.3) * 0.01;
    const driftZ = Mathf.sin(time * 0.4 + phase * 0.7) * 0.02;
    
    // Update positions
    let x = load<f32>(posIdx) + driftX;
    let y = load<f32>(posIdx + 4) + driftY;
    let z = load<f32>(posIdx + 8) + driftZ;
    
    // Wrap boundaries
    if (x > halfArea) x = -halfArea;
    if (x < -halfArea) x = halfArea;
    if (y < 0.3) y = 0.3;
    if (y > 5.0) y = 5.0;
    if (z > halfArea) z = -halfArea;
    if (z < -halfArea) z = halfArea;
    
    // Store updated positions
    store<f32>(posIdx, x);
    store<f32>(posIdx + 4, y);
    store<f32>(posIdx + 8, z);
  }
}
