import { COLLISION_OFFSET, COLLISION_STRIDE, MAX_COLLISION_OBJECTS, PLAYER_STATE_OFFSET, POSITION_OFFSET } from "./constants";

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
}

export function addCollisionObject(type: i32, x: f32, y: f32, z: f32, d1: f32, d2: f32, d3: f32, flags: i32): void {
  if (collisionObjectCount >= MAX_COLLISION_OBJECTS) return;

  const ptr = COLLISION_OFFSET + (collisionObjectCount * COLLISION_STRIDE);

  // Store as f32, cast type/flags
  store<f32>(ptr, f32(type));
  store<f32>(ptr + 4, x);
  store<f32>(ptr + 8, y);
  store<f32>(ptr + 12, z);
  store<f32>(ptr + 16, d1); // Radius or Scale X
  store<f32>(ptr + 20, d2); // Height or Scale Y
  store<f32>(ptr + 24, d3); // Depth or Extra
  store<f32>(ptr + 28, f32(flags));

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

  for (let i = 0; i < collisionObjectCount; i++) {
    const objPtr = COLLISION_OFFSET + (i * COLLISION_STRIDE);
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
          px += pushX;
          pz += pushZ;
          vx *= 0.5; // Dampen velocity
          vz *= 0.5;
          modified = true;
        }
      }
      continue;
    }

    // --- PLATFORMS (Mushroom / Cloud) ---
    // Optimisation: Only check if we are falling or stable
    if (vy <= 0.0) {
      let isHit = false;
      let surfaceY: f32 = 0.0;
      let radiusSq: f32 = 0.0;
      let checkHeight = false;

      if (type == TYPE_MUSHROOM || type == TYPE_TRAMPOLINE) {
        // Cylinder Cap
        // d1 = capRadius, d2 = capHeight
        // Note: For mushrooms, oy is base. surfaceY is oy + d2
        surfaceY = oy + d2;
        radiusSq = d1 * d1;
        if (distSq < radiusSq) {
          checkHeight = true;
        }
      } else if (type == TYPE_CLOUD) {
        // Cloud Platform (Box-ish or Cylinder)
        // d1 = ScaleX (treated as radius * 2 roughly)
        // Cloud collision logic from JS: dist < scaleX * 2.0
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
                // We don't snap Y for trampoline, just boost
                modified = true;
                // Add discovery flag logic if we could write back metadata
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
