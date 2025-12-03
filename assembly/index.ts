// AssemblyScript Terrain Module

// Single source of truth for terrain height
export function getTerrainHeight(x: f32, z: f32): f32 {
  // Enhanced multi-octave hills (matching the detailed JS version)
  // Note: Using 'z' as the second coordinate
  let h: f32 = 0.0;
  h += Mathf.sin(x * 0.05) * 2.0 + Mathf.cos(z * 0.05) * 2.0;
  h += Mathf.sin(x * 0.1) * 0.8 + Mathf.cos(z * 0.1) * 0.8;
  h += Mathf.sin(x * 0.2) * 0.3 + Mathf.cos(z * 0.2) * 0.3;

  return h;
}

// Generate heightmap for a buffer
// ptr: Pointer to float array of Z values
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
      // Note: We use -worldZ to match the coordinate system if needed, or just worldZ.
      // Based on previous code, let's stick to -worldZ as originally used.
      let y = getTerrainHeight(worldX, -worldZ);

      // Store at index
      let index = (z * widthVertices) + x;
      // 4 bytes per float
      store<f32>(ptr + (<usize>index * 4), y);
    }
  }
}
