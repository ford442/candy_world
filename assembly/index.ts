// AssemblyScript Physics & Terrain Module

// Updates a particle buffer in linear memory
// Buffer Layout: [x, y, z, life, vx, vy, vz, speed] (8 floats per particle)
export function updateParticles(ptr: usize, count: i32, dt: f32): void {
  for (let i = 0; i < count; i++) {
    let offset = ptr + (<usize>i * 32); // 8 floats * 4 bytes

    // Load
    let px = load<f32>(offset);
    let py = load<f32>(offset + 4);
    let pz = load<f32>(offset + 8);
    let life = load<f32>(offset + 12);

    let vx = load<f32>(offset + 16);
    let vy = load<f32>(offset + 20);
    let vz = load<f32>(offset + 24);
    let speed = load<f32>(offset + 28);

    // Update
    vy -= 2.0 * dt; // Gravity
    px += vx * dt * speed;
    py += vy * dt * speed;
    pz += vz * dt * speed;
    life -= dt * 0.2;

    // Reset if dead
    if (life <= 0.0) {
      py = 10.0;
      life = 1.0;
      vy = 2.0; // Reset velocity
      // Randomize x/z slightly
      px = (<f32>Math.random() - 0.5) * 5.0;
      pz = (<f32>Math.random() - 0.5) * 5.0;
      vx = (<f32>Math.random() - 0.5) * 2.0;
      vz = (<f32>Math.random() - 0.5) * 2.0;
    }

    // Store
    store<f32>(offset, px);
    store<f32>(offset + 4, py);
    store<f32>(offset + 8, pz);
    store<f32>(offset + 12, life);
    store<f32>(offset + 16, vx);
    store<f32>(offset + 20, vy);
    store<f32>(offset + 24, vz);
  }
}

export function checkCollision(playerX: f32, playerZ: f32, playerRadius: f32, objectCount: i32): i32 {
    // Placeholder for future collision logic
    return 0;
}

// --- NEW: Terrain Logic ---

// Single source of truth for terrain height
export function getTerrainHeight(x: f32, z: f32): f32 {
  // Enhanced multi-octave hills (matching the detailed JS version)
  // Note: Using 'z' as the second coordinate, which corresponds to 'y' in the PlaneGeometry UV space before rotation
  // In JS: Math.sin(x * 0.05) * 2 + Math.cos(y * 0.05) * 2
  // We use -z here to match the world space coordinate system if needed, or just z.

  let h: f32 = 0.0;
  h += Mathf.sin(x * 0.05) * 2.0 + Mathf.cos(z * 0.05) * 2.0;
  h += Mathf.sin(x * 0.1) * 0.8 + Mathf.cos(z * 0.1) * 0.8;
  h += Mathf.sin(x * 0.2) * 0.3 + Mathf.cos(z * 0.2) * 0.3;

  return h;
}

// Generate heightmap for a buffer
// ptr: Pointer to float array of Z values (or Y values depending on orientation)
// width, depth: segments + 1
// scale: spacing between vertices
export function generateTerrainMesh(ptr: usize, widthVertices: i32, depthVertices: i32, spacing: f32): void {
  let offsetX = (<f32>widthVertices - 1.0) * spacing * 0.5;
  let offsetZ = (<f32>depthVertices - 1.0) * spacing * 0.5;

  for (let z = 0; z < depthVertices; z++) {
    for (let x = 0; x < widthVertices; x++) {
      let worldX = (<f32>x * spacing) - offsetX;
      let worldZ = (<f32>z * spacing) - offsetZ;

      // Calculate height
      // Note: In PlaneGeometry, usually Z is height before rotation, but we often map Y to Z in loops.
      // Let's assume we are writing to a buffer that expects height values.
      let y = getTerrainHeight(worldX, -worldZ); // Flip Z to match typical WebGL coords if needed

      // Store at index
      let index = (z * widthVertices) + x;
      // 4 bytes per float
      store<f32>(ptr + (<usize>index * 4), y);
    }
  }
}

