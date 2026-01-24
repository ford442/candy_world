import {
  COLLISION_OFFSET,
  COLLISION_STRIDE,
  MAX_COLLISION_OBJECTS,
  PLAYER_STATE_OFFSET,
  POSITION_OFFSET,
  GRID_HEADS_OFFSET,
  GRID_NEXT_OFFSET,
  GRID_CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Z
} from "./constants";

// Object Types
const TYPE_MUSHROOM = 1;   // Platform (Cylinder-like)
const TYPE_CLOUD = 2;      // Platform (Box/Cylinder)
const TYPE_GATE = 3;       // Horizontal Blocker (Cylinder)
const TYPE_TRAMPOLINE = 4; // Bouncy Platform

// Player Constants
const PLAYER_HEIGHT: f32 = 1.8;
const PLAYER_RADIUS: f32 = 0.5;

// Global collision count
let collisionObjectCount: i32 = 0;

export function initCollisionSystem(): void {
  collisionObjectCount = 0;

  // Clear Grid Heads
  const gridCount = GRID_COLS * GRID_ROWS;
  for (let i = 0; i < gridCount; i++) {
    store<i32>(GRID_HEADS_OFFSET + (i * 4), -1);
  }

  // Clear Next Pointers
  for (let i = 0; i < MAX_COLLISION_OBJECTS; i++) {
    store<i32>(GRID_NEXT_OFFSET + (i * 4), -1);
  }
}

function getGridIndex(x: f32, z: f32): i32 {
  const col = i32(Math.floor((x - GRID_ORIGIN_X) / GRID_CELL_SIZE));
  const row = i32(Math.floor((z - GRID_ORIGIN_Z) / GRID_CELL_SIZE));

  if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) {
    return -1;
  }
  return row * GRID_COLS + col;
}

export function addCollisionObject(type: i32, x: f32, y: f32, z: f32, d1: f32, d2: f32, d3: f32, flags: i32): void {
  if (collisionObjectCount >= MAX_COLLISION_OBJECTS) return;

  const id = collisionObjectCount;
  const ptr = COLLISION_OFFSET + (id * COLLISION_STRIDE);

  // Store as f32, cast type/flags
  store<f32>(ptr, f32(type));
  store<f32>(ptr + 4, x);
  store<f32>(ptr + 8, y);
  store<f32>(ptr + 12, z);
  store<f32>(ptr + 16, d1); // Radius or Scale X
  store<f32>(ptr + 20, d2); // Height or Scale Y
  store<f32>(ptr + 24, d3); // Depth or Extra
  store<f32>(ptr + 28, f32(flags));

  // Add to Spatial Grid
  const gridIdx = getGridIndex(x, z);
  if (gridIdx >= 0) {
    const headPtr = GRID_HEADS_OFFSET + (gridIdx * 4);
    const oldHead = load<i32>(headPtr);

    // Store old head as next
    store<i32>(GRID_NEXT_OFFSET + (id * 4), oldHead);

    // Set new head
    store<i32>(headPtr, id);
  }

  collisionObjectCount++;
}

// Check collision for simple sphere (Legacy support)
export function checkCollision(playerX: f32, playerZ: f32, playerRadius: f32, objectCount: i32): i32 {
  for (let i = 0; i < objectCount; i++) {
    const ptr = POSITION_OFFSET + i * 16;
    const objX = load<f32>(ptr);
    const objZ = load<f32>(ptr + 8); // Skip Y
    const objR = load<f32>(ptr + 12);

    const dx = playerX - objX;
    const dz = playerZ - objZ;
    const distSq = dx * dx + dz * dz;
    const radii = playerRadius + objR;

    if (distSq < radii * radii) {
      return 1; // Collision detected
    }
  }
  return 0;
}

export function checkPositionValidity(x: f32, z: f32, radius: f32): i32 {
  const centerCol = i32(Math.floor((x - GRID_ORIGIN_X) / GRID_CELL_SIZE));
  const centerRow = i32(Math.floor((z - GRID_ORIGIN_Z) / GRID_CELL_SIZE));

  for (let row = centerRow - 1; row <= centerRow + 1; row++) {
    for (let col = centerCol - 1; col <= centerCol + 1; col++) {
      if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) continue;

      const gridIdx = row * GRID_COLS + col;
      let objId = load<i32>(GRID_HEADS_OFFSET + (gridIdx * 4));

      while (objId != -1) {
        const ptr = COLLISION_OFFSET + (objId * COLLISION_STRIDE);
        // We only care about position (offsets 4, 12) and radius (offset 16)
        // Format: type(0), x(4), y(8), z(12), r(16), h(20)...
        const ox = load<f32>(ptr + 4);
        const oz = load<f32>(ptr + 12);
        const or = load<f32>(ptr + 16);

        const dx = x - ox;
        const dz = z - oz;
        const distSq = dx * dx + dz * dz;
        const minDistance = or + radius + 1.5; // Matches generation.ts logic

        if (distSq < minDistance * minDistance) {
          return 1;
        }
        objId = load<i32>(GRID_NEXT_OFFSET + (objId * 4));
      }
    }
  }
  return 0;
}

// Main Narrow Phase Resolver
// Reads player state from PLAYER_STATE_OFFSET, modifies it, and writes back.
// Returns a status code (1 = collision/modification occurred, 0 = none)
export function resolveGameCollisions(kickTrigger: f32): i32 {
  const pPtr = PLAYER_STATE_OFFSET;

  let px = load<f32>(pPtr);
  let py = load<f32>(pPtr + 4);
  let pz = load<f32>(pPtr + 8);
  let vx = load<f32>(pPtr + 12);
  let vy = load<f32>(pPtr + 16);
  let vz = load<f32>(pPtr + 20);

  // Reset grounded flag (consumer should set it back if other physics handled it)
  // But here we set it if we land on something
  let isGrounded = load<f32>(pPtr + 24) > 0.5;
  let modified = false;

  // Determine Player's Grid Cell
  const centerCol = i32(Math.floor((px - GRID_ORIGIN_X) / GRID_CELL_SIZE));
  const centerRow = i32(Math.floor((pz - GRID_ORIGIN_Z) / GRID_CELL_SIZE));

  // Check 3x3 Grid Cells
  for (let row = centerRow - 1; row <= centerRow + 1; row++) {
    for (let col = centerCol - 1; col <= centerCol + 1; col++) {

      if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) continue;

      const gridIdx = row * GRID_COLS + col;
      let objId = load<i32>(GRID_HEADS_OFFSET + (gridIdx * 4));

      while (objId != -1) {
        const objPtr = COLLISION_OFFSET + (objId * COLLISION_STRIDE);

        const type = i32(load<f32>(objPtr));
        const ox = load<f32>(objPtr + 4);
        const oy = load<f32>(objPtr + 8);
        const oz = load<f32>(objPtr + 12);
        const d1 = load<f32>(objPtr + 16); // Radius / ScaleX
        const d2 = load<f32>(objPtr + 20); // Height / ScaleY
        const d3 = load<f32>(objPtr + 24); // Depth
        const flags = i32(load<f32>(objPtr + 28));

        const dx = px - ox;
        const dz = pz - oz;
        const distSq = dx * dx + dz * dz;

        // --- GATE (Cylinder Push) ---
        if (type == TYPE_GATE) {
          // d1 = radius
          if (distSq < (d1 + PLAYER_RADIUS) * (d1 + PLAYER_RADIUS)) {
            // Simple Push out
            const dist = Math.sqrt(distSq);
            if (dist > 0.001) {
              const pushX = (dx / dist) * 0.2; // Push force
              const pushZ = (dz / dist) * 0.2;
              px += <f32>pushX;
              pz += <f32>pushZ;
              vx *= 0.5; // Dampen velocity
              vz *= 0.5;
              modified = true;
            }
          }
        }
        // --- PLATFORMS (Mushroom / Cloud) ---
        // Optimisation: Only check if we are falling or stable
        else if (vy <= 0.0) {
          let checkHeight = false;
          let surfaceY: f32 = 0.0;
          let radiusSq: f32 = 0.0;

          if (type == TYPE_MUSHROOM || type == TYPE_TRAMPOLINE) {
            // Cylinder Cap
            // d1 = capRadius, d2 = capHeight
            surfaceY = oy + d2;
            radiusSq = d1 * d1;
            if (distSq < radiusSq) {
              checkHeight = true;
            }
          } else if (type == TYPE_CLOUD) {
            // Cloud Platform (Box-ish or Cylinder)
            // d1 = ScaleX (treated as radius * 2 roughly)
            const radius = d1 * 2.0;
            radiusSq = radius * radius;
            // Top Y logic: pos.y + scale.y * 0.8
            surfaceY = oy + d2 * 0.8;

            if (distSq < radiusSq) {
              checkHeight = true;
            }
          }

          if (checkHeight) {
            // Check vertical overlap
            // Player feet (py) should be slightly above surface
            // Snap window: surfaceY - 0.5 to surfaceY + 2.0
            if (py >= surfaceY - 0.5 && py <= surfaceY + 3.0) {

                if (type == TYPE_TRAMPOLINE) {
                    // Bounce
                    vy = 15.0 + (kickTrigger * 10.0);
                    isGrounded = false;
                    modified = true;
                } else {
                    // Solid Land
                    py = surfaceY + PLAYER_HEIGHT;
                    vy = 0.0;
                    isGrounded = true;
                    modified = true;
                }
            }
          }
        }

        // Move to next object in this cell
        objId = load<i32>(GRID_NEXT_OFFSET + (objId * 4));
      }
    }
  }

  if (modified) {
    store<f32>(pPtr, px);
    store<f32>(pPtr + 4, py);
    store<f32>(pPtr + 8, pz);
    store<f32>(pPtr + 12, vx);
    store<f32>(pPtr + 16, vy);
    store<f32>(pPtr + 20, vz);
    store<f32>(pPtr + 24, isGrounded ? 1.0 : 0.0);
    return 1;
  }

  return 0;
}
