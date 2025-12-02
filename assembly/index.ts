// AssemblyScript Physics Module

// Helper to load a float from memory
// In AS, we can access memory directly.
// We assume the buffer passed from JS is just a pointer to linear memory.

// Buffer Layout: [x, y, z, life, vx, vy, vz, speed] (8 floats per particle)
export function initParticles(ptr: usize, count: i32): void {
  for (let i = 0; i < count; i++) {
    let offset = ptr + (<usize>i * 32); // 8 floats * 4 bytes

    // x: -25 to 25
    store<f32>(offset, (Math.random() as f32 - 0.5) * 50.0);
    // y: 0 to 20
    store<f32>(offset + 4, Math.random() as f32 * 20.0);
    // z: -25 to 25
    store<f32>(offset + 8, (Math.random() as f32 - 0.5) * 50.0);
    // life: 0 to 1
    store<f32>(offset + 12, Math.random() as f32);

    // vx: -1 to 1
    store<f32>(offset + 16, (Math.random() as f32 - 0.5) * 2.0);
    // vy: 0 to 5
    store<f32>(offset + 20, Math.random() as f32 * 5.0);
    // vz: -1 to 1
    store<f32>(offset + 24, (Math.random() as f32 - 0.5) * 2.0);
    // speed: 1 to 2
    store<f32>(offset + 28, 1.0 + Math.random() as f32);
  }
}

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
      px = (Math.random() as f32 - 0.5) * 10.0;
      pz = (Math.random() as f32 - 0.5) * 10.0;
      vx = (Math.random() as f32 - 0.5) * 4.0;
      vz = (Math.random() as f32 - 0.5) * 4.0;
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

export function checkCollision(ptr: usize, count: i32, playerX: f32, playerZ: f32, radius: f32): void {
  let rSq = radius * radius;

  for (let i = 0; i < count; i++) {
    let offset = ptr + (<usize>i * 32);
    let px = load<f32>(offset);
    let py = load<f32>(offset + 4);
    let pz = load<f32>(offset + 8);
    let vy = load<f32>(offset + 20);

    // Floor collision
    if (py < 0.0) {
      store<f32>(offset + 4, 0.0); // py = 0
      store<f32>(offset + 20, -vy * 0.5); // vy bounce
    }

    // Simple player push (ignoring Y for cylinder check)
    let dx = px - playerX;
    let dz = pz - playerZ;
    let distSq = dx * dx + dz * dz;

    if (distSq < rSq) {
      let dist = Math.sqrt(distSq) as f32;
      if (dist > 0.0001) {
        let push = (radius - dist) / dist;
        store<f32>(offset, px + dx * push);
        store<f32>(offset + 8, pz + dz * push);
      }
    }
  }
}
