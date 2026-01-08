// Shared memory offsets
// 0-4095: Position data (x, y, z, radius) for up to 256 objects (16 bytes each)
export const POSITION_OFFSET: i32 = 0;
// 4096-8191: Animation state (currentY, targetY, velocity, phase)
export const ANIMATION_OFFSET: i32 = 4096;
// 8192-12287: Output buffer for batch operations
export const OUTPUT_OFFSET: i32 = 8192;
// 12288-16383: Material data for shader analysis (Strategy 3)
export const MATERIAL_DATA_OFFSET: i32 = 12288;

// New Offsets for Physics
// 16384-16415: Player State IO (8 floats: x,y,z, vx,vy,vz, isGrounded, padding)
export const PLAYER_STATE_OFFSET: i32 = 16384;
// 16416+: Collision Objects (Type, x,y,z, d1,d2,d3, flags) -> 8 floats * 512 objects = 16KB
export const COLLISION_OFFSET: i32 = 16416;
export const MAX_COLLISION_OBJECTS: i32 = 512;
export const COLLISION_STRIDE: i32 = 32; // bytes
