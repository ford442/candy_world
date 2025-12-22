// Shared memory offsets
// 0-4095: Position data (x, y, z, radius) for up to 256 objects (16 bytes each)
export const POSITION_OFFSET: i32 = 0;
// 4096-8191: Animation state (currentY, targetY, velocity, phase)
export const ANIMATION_OFFSET: i32 = 4096;
// 8192+: Output buffer for batch operations
export const OUTPUT_OFFSET: i32 = 8192;
