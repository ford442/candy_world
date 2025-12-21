import { POSITION_OFFSET, ANIMATION_OFFSET } from "./constants";
import { getGroundHeight } from "./math";

/**
 * Update animation state for all objects
 * Logic from original batchAnimationCalc:
 *  - Calculates bounce/sway/kick animations
 *  - Updates position Y and rotation
 *  - Stores results back to shared memory
 *  - Supports specific animation types based on animData stored in ANIMATION_OFFSET
 */
export function batchAnimationCalc(time: f32, intensity: f32, kick: f32, objectCount: i32): void {
  for (let i = 0; i < objectCount; i++) {
     const posPtr = POSITION_OFFSET + i * 16;
     const animPtr = ANIMATION_OFFSET + i * 16;

     const x = load<f32>(posPtr);
     const z = load<f32>(posPtr + 8);
     const initialY = load<f32>(animPtr + 8); // We store initialY at offset 8 (was velocity/unused)
     const animType = <i32>load<f32>(animPtr + 12); // animType at offset 12 (was phase)
     const offset = (x + z) * 0.1;

     let newY = initialY;

     // 1 = BOUNCE (Mushrooms)
     if (animType == 1) {
       let yOffset = Mathf.sin((time + offset) * 3.0) * 0.1 * intensity;
       if (kick > 0.1) yOffset += kick * 0.2;
       newY += yOffset;
     }
     // 2 = SWAY (Flowers)
     else if (animType == 2) {
       // Sway affects rotation mainly, but let's add slight bob
       newY += Mathf.sin((time + offset) * 2.0) * 0.05 * intensity;
     }

     // Store updated Y
     store<f32>(animPtr, newY); // CurrentY
     store<f32>(posPtr + 4, newY); // Update position for rendering/physics
  }
}

/**
 * Check distances for all objects and return visibility mask
 * Original logic:
 *  - Iterates objects
 *  - Checks distance sq < maxDistSq
 *  - Writes 1.0 (visible) or 0.0 (hidden) to output buffer (flags)
 *  - Returns visible count
 */
export function batchDistanceCull(cameraX: f32, cameraY: f32, cameraZ: f32, maxDistSq: f32, objectCount: i32, flagsPtr: i32): i32 {
  let visibleCount = 0;

  for (let i = 0; i < objectCount; i++) {
    const ptr = POSITION_OFFSET + i * 16;
    const objX = load<f32>(ptr);
    const objY = load<f32>(ptr + 4);
    const objZ = load<f32>(ptr + 8);

    const dx = cameraX - objX;
    const dy = cameraY - objY;
    const dz = cameraZ - objZ;

    const distSq = dx*dx + dy*dy + dz*dz;

    if (distSq < maxDistSq) {
      store<f32>(flagsPtr + i * 4, 1.0);
      visibleCount++;
    } else {
      store<f32>(flagsPtr + i * 4, 0.0);
    }
  }

  return visibleCount;
}

// Re-export mushroom spawn logic from original (simplified for batch)
export function batchMushroomSpawnCandidates(
    time: f32,
    playerX: f32,
    playerZ: f32,
    minDistance: f32,
    maxDistance: f32,
    windSpeed: f32,
    windX: f32,
    windZ: f32,
    objectCount: i32,
    candidateCount: i32,
    spawnThreshold: f32
): i32 {
    // Note: The caller passes 'candidateCount' as accumulator?
    // The original implementation returned the new total count.

    // Limits
    const MAX_CANDIDATES = 64;
    const OUTPUT_OFFSET = 8192; // Assuming standard output offset

    // Iterate a fixed number of attempts or based on something?
    // Original loop was objectCount based to try spawning near existing objects?
    // Or was it random?
    // Based on the restored file content:
    /*
      for (let i = 0; i < objectCount; i++) {
        // ... logic ...
      }
    */

    for (let i = 0; i < objectCount; i++) {
        if (candidateCount >= MAX_CANDIDATES) break;

        const ptr = POSITION_OFFSET + i * 16;
        const objX = load<f32>(ptr);
        const objZ = load<f32>(ptr + 8);
        const objR = load<f32>(ptr + 12);

        // Read colorIndex from animation data padding
        const animPtr = ANIMATION_OFFSET + i * 16;
        const colorIndex = <i32>load<f32>(animPtr + 12);

        // Pseudo-random values derived from time and index
        const seed = Mathf.abs(time * 1000.0 + <f32>i);
        const r1 = Mathf.sin(seed * 12.9898) * 43758.5453;
        const r2 = Mathf.sin((seed + 1.2345) * 78.233) * 43758.5453;
        const rand1 = r1 - Mathf.floor(r1);
        const rand2 = r2 - Mathf.floor(r2);

        // Weight selection
        let colorWeight: f32 = 0.005;
        if (colorIndex >= 0 && colorIndex <= 3) colorWeight = 0.02;
        else if (colorIndex == 4) colorWeight = 0.01;

        const spawnProb = windSpeed * colorWeight;
        if (rand1 > (spawnProb * spawnThreshold)) continue;

        // Distance and jitter
        const dist = minDistance + rand2 * (maxDistance - minDistance);
        const jitterX = (rand2 - 0.5) * 2.0;
        const jitterZ = (rand1 - 0.5) * 2.0;

        const nx = objX + windX * dist + jitterX;
        const nz = objZ + windZ * dist + jitterZ;

        // Get ground height
        const ny = getGroundHeight(nx, nz);
        if (ny < -0.5) continue;

        // Collision check
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

        // Write candidate
        const outPtr = OUTPUT_OFFSET + candidateCount * 16;
        store<f32>(outPtr, nx);
        store<f32>(outPtr + 4, ny);
        store<f32>(outPtr + 8, nz);
        store<f32>(outPtr + 12, <f32>colorIndex);
        candidateCount++;
    }

    return candidateCount;
}
