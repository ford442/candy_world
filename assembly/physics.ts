import { POSITION_OFFSET } from "./constants";

export function checkCollision(playerX: f32, playerZ: f32, playerRadius: f32, objectCount: i32): i32 {
  // Simple circle collision check against all objects
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
