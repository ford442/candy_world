// AssemblyScript Physics Module

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
      // AssemblyScript math.random() returns f64 [0,1)
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
    // Existing logic...
    return 0;
}
