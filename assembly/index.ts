// AssemblyScript Physics Module
// Simple collision detection for circular objects in 2D (x, z)

// We will store object data in linear memory: [x, z, radius, x, z, radius, ...]
// The offset of the first object is 0.

export function checkCollision(playerX: f32, playerZ: f32, playerRadius: f32, objectCount: i32): i32 {
  for (let i = 0; i < objectCount; i++) {
    // Each object takes 3 float32s (12 bytes)
    // In AssemblyScript, loading from memory requires byte offset?
    // Actually, we can just use pointers or assuming a buffer is passed.
    // For simplicity in this demo, we assume data is stored at memory location 0 onwards.

    // Load object data
    // Note: In real implementation, we'd manage memory pointers more carefully.
    // Here we assume a dedicated memory segment for objects.
    let ptr = i * 12;
    let objX = load<f32>(ptr);
    let objZ = load<f32>(ptr + 4);
    let objR = load<f32>(ptr + 8);

    // Distance squared
    let dx = playerX - objX;
    let dz = playerZ - objZ;
    let distSq = dx * dx + dz * dz;

    let radii = playerRadius + objR;
    if (distSq < radii * radii) {
      return 1; // Collision detected
    }
  }
  return 0; // No collision
}
