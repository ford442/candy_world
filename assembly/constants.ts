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
// INCREASED to 4096 to support full world generation (3000+ objects)
export const MAX_COLLISION_OBJECTS: i32 = 4096;
export const COLLISION_STRIDE: i32 = 32; // bytes

// 16416 - 147488: Collision Object Data (128KB)
export const COLLISION_OFFSET: i32 = 16416;

// Spatial Grid Constants
export const GRID_CELL_SIZE: f32 = 16.0;
export const GRID_COLS: i32 = 16;
export const GRID_ROWS: i32 = 16;
export const GRID_ORIGIN_X: f32 = -128.0;
export const GRID_ORIGIN_Z: f32 = -128.0;

// Grid Heads (16*16 * 4 bytes = 1KB)
// Automatically calculated based on COLLISION_OFFSET + (MAX * STRIDE)
export const GRID_HEADS_OFFSET: i32 = COLLISION_OFFSET + (MAX_COLLISION_OBJECTS * COLLISION_STRIDE);

// Grid Next Pointers (MAX * 4 bytes = 16KB)
export const GRID_NEXT_OFFSET: i32 = GRID_HEADS_OFFSET + (GRID_COLS * GRID_ROWS * 4);

// Dynamic Foliage Radii Sync (Max 512 dynamic plants * 4 bytes = 2KB)
export const MAX_DYNAMIC_PLANTS: i32 = 512;
export const DYNAMIC_RADII_OFFSET: i32 = GRID_NEXT_OFFSET + (MAX_COLLISION_OBJECTS * 4);

// Batch Upload Buffer (Supports max objects * 8 floats per object * 4 bytes = 128KB)
export const BATCH_UPLOAD_OFFSET: i32 = DYNAMIC_RADII_OFFSET + (MAX_DYNAMIC_PLANTS * 4);

// Discovery System (shared with emscripten/discovery.cpp)
export const MAX_DISCOVERY_OBJECTS: i32 = 3000;

// -----------------------------------------------------------------------------
// Dynamic Rigid Bodies (see assembly/rigidbody.ts, docs/PERF_BUDGETS.md)
// -----------------------------------------------------------------------------
// Hard cap on simultaneously simulated dynamic bodies. Kept small on purpose:
// this is a "few interactive props" solver, not a general rigid-body world.
export const MAX_DYNAMIC_BODIES: i32 = 64;
// 16 f32 per body (see RB_* field offsets in rigidbody.ts)
export const RIGID_BODY_STRIDE: i32 = 64; // bytes

// NOTE: the body pool is NOT a fixed offset in the raw low-memory block above.
// It is a managed StaticArray whose data pointer is returned by
// initRigidBodySystem(), so it can never overlap the hand-rolled offsets.

// World bounds for dynamic bodies. Mirrors the particle bounds asserted by
// tests/wasm.mjs so nothing can escape the spatial grid footprint.
export const RB_MIN_X: f32 = -128.0;
export const RB_MAX_X: f32 = 128.0;
export const RB_MIN_Z: f32 = -128.0;
export const RB_MAX_Z: f32 = 128.0;
export const RB_MIN_Y: f32 = -100.0;
export const RB_MAX_Y: f32 = 500.0;

// -----------------------------------------------------------------------------
// Rigid-body record layout (shared with assembly/joints.ts)
// -----------------------------------------------------------------------------
// Field indices are in *floats* relative to a body base. Mirrored by RB_FIELD /
// RB_FLAG in src/systems/physics/rigid-body-types.ts and by the F map in
// tests/rigid-body.mjs — change all four together.
export const RB_FLOATS_PER_BODY: i32 = RIGID_BODY_STRIDE / 4;

export const RB_F_PX: i32 = 0;
export const RB_F_PY: i32 = 1;
export const RB_F_PZ: i32 = 2;
export const RB_F_VX: i32 = 3;
export const RB_F_VY: i32 = 4;
export const RB_F_VZ: i32 = 5;
export const RB_F_INV_MASS: i32 = 6;  // 0 => infinite mass (kinematic / static)
export const RB_F_RESTITUTION: i32 = 7;
export const RB_F_FRICTION: i32 = 8;
export const RB_F_D1: i32 = 9;        // sphere/capsule radius, or box half-X
export const RB_F_D2: i32 = 10;       // capsule half segment height, or box half-Y
export const RB_F_D3: i32 = 11;       // box half-Z (unused by sphere/capsule)
export const RB_F_SHAPE: i32 = 12;
export const RB_F_FLAGS: i32 = 13;
export const RB_F_SLEEP: i32 = 14;    // seconds spent below the sleep threshold
export const RB_F_USER: i32 = 15;     // opaque handle owned by the TS bridge

export const RB_FLAG_ACTIVE: i32 = 1;
export const RB_FLAG_KINEMATIC: i32 = 2;
export const RB_FLAG_SLEEPING: i32 = 4;
export const RB_FLAG_GROUNDED: i32 = 8;

// -----------------------------------------------------------------------------
// Joints (see assembly/joints.ts, docs/PERF_BUDGETS.md)
// -----------------------------------------------------------------------------
// Hard cap on simultaneously solved constraints. Like MAX_DYNAMIC_BODIES this
// is a "a few interactive toys" budget, not a general constraint world.
export const MAX_JOINTS: i32 = 64;
// 16 f32 per joint (see J_* field offsets in joints.ts)
export const JOINT_STRIDE: i32 = 64; // bytes

// NOTE: like the body pool, the joint pool is a managed StaticArray whose data
// pointer is returned by initJointSystem() — never a fixed offset above.
