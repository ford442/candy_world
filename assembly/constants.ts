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

// Physics Collision Memory Layout
export const MAX_COLLISION_OBJECTS: i32 = 2048;
export const COLLISION_STRIDE: i32 = 32; // bytes

// 16416 - 81952: Collision Object Data (64KB)
export const COLLISION_OFFSET: i32 = 16416;

// Spatial Grid Constants
export const GRID_CELL_SIZE: f32 = 16.0;
export const GRID_COLS: i32 = 16;
export const GRID_ROWS: i32 = 16;
export const GRID_ORIGIN_X: f32 = -128.0;
export const GRID_ORIGIN_Z: f32 = -128.0;

// 81952 - 82976: Grid Heads (16*16 * 4 bytes = 1KB)
export const GRID_HEADS_OFFSET: i32 = COLLISION_OFFSET + (MAX_COLLISION_OBJECTS * COLLISION_STRIDE);

// 82976 - 91168: Grid Next Pointers (2048 * 4 bytes = 8KB)
export const GRID_NEXT_OFFSET: i32 = GRID_HEADS_OFFSET + (GRID_COLS * GRID_ROWS * 4);
