// assembly/rigidbody.ts
//
// Lightweight dynamic rigid-body layer for a *small* number of interactive
// props (candy crates, bumpable gumdrops, ability-launched debris).
//
// Scope, on purpose:
//   - semi-implicit Euler + substepping, no rotation, no stacking guarantees,
//     no ragdolls, no soft bodies
//   - basic constraints (fixed / hinge / spring) live in assembly/joints.ts and
//     are solved from substep() below; everything else is out of scope
//   - sphere / vertical-capsule / AABB colliders
//   - broadphase reuses the existing static spatial grid (assembly/physics.ts)
//     and the unified ground height (assembly/ground.ts); body-body is a plain
//     O(n^2) sweep, which at MAX_DYNAMIC_BODIES = 64 is ~2k pairs
//   - the player is a one-way *kinematic proxy*: it pushes bodies, bodies never
//     push it back. The character controller stays authoritative (see
//     docs/CHARACTER_CONTROLLER.md).
//
// Memory: the pool is a managed StaticArray<f32>, not one of the hand-rolled
// offsets in constants.ts, so it can never overlap the raw collision/grid
// blocks. initRigidBodySystem() returns its data pointer for the TS bridge to
// build a zero-copy Float32Array view over.

import {
  MAX_DYNAMIC_BODIES,
  RIGID_BODY_STRIDE,
  RB_MIN_X,
  RB_MAX_X,
  RB_MIN_Y,
  RB_MAX_Y,
  RB_MIN_Z,
  RB_MAX_Z,
  COLLISION_OFFSET,
  COLLISION_STRIDE,
  GRID_HEADS_OFFSET,
  GRID_NEXT_OFFSET,
  GRID_CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Z,
  DYNAMIC_RADII_OFFSET,
  RB_F_PX as F_PX,
  RB_F_PY as F_PY,
  RB_F_PZ as F_PZ,
  RB_F_VX as F_VX,
  RB_F_VY as F_VY,
  RB_F_VZ as F_VZ,
  RB_F_INV_MASS as F_INV_MASS,
  RB_F_RESTITUTION as F_RESTITUTION,
  RB_F_FRICTION as F_FRICTION,
  RB_F_D1 as F_D1,
  RB_F_D2 as F_D2,
  RB_F_D3 as F_D3,
  RB_F_SHAPE as F_SHAPE,
  RB_F_FLAGS as F_FLAGS,
  RB_F_SLEEP as F_SLEEP,
  RB_F_USER as F_USER,
  RB_FLAG_ACTIVE as FLAG_ACTIVE,
  RB_FLAG_KINEMATIC as FLAG_KINEMATIC,
  RB_FLAG_SLEEPING as FLAG_SLEEPING,
  RB_FLAG_GROUNDED as FLAG_GROUNDED,
} from './constants';

import { getCollisionObjectCount } from './physics';
import { getUnifiedGroundHeight } from './ground';
import { initJointSystem, jointsClear, jointsOnBodyRemoved, solveJoints } from './joints';

// -----------------------------------------------------------------------------
// Layout — 16 f32 per body (RIGID_BODY_STRIDE = 64 bytes)
// -----------------------------------------------------------------------------
// Indices are in *floats* relative to the body base; the F_* / FLAG_* names
// above are import aliases for the RB_F_* / RB_FLAG_* layout in constants.ts,
// which assembly/joints.ts reads through the same field indices.

const FLOATS_PER_BODY: i32 = RIGID_BODY_STRIDE / 4;

// Collider shapes
export const RB_SHAPE_SPHERE: i32 = 0;
export const RB_SHAPE_CAPSULE: i32 = 1;
export const RB_SHAPE_BOX: i32 = 2;

// -----------------------------------------------------------------------------
// Tuning
// -----------------------------------------------------------------------------
const GRAVITY: f32 = -22.0;          // matches the player controller's feel
const LINEAR_DAMPING: f32 = 0.06;    // per second
const MAX_SPEED: f32 = 80.0;         // hard clamp, keeps the integrator stable
const MAX_SUBSTEP: f32 = 1.0 / 120.0;
const MAX_SUBSTEPS: i32 = 8;
const MAX_FRAME_DT: f32 = 0.1;       // ignore hitches / tab-restore spikes

const SLEEP_LINEAR_SPEED: f32 = 0.28;
const SLEEP_TIME: f32 = 0.6;
const WAKE_SPEED: f32 = 0.45;

const SKIN: f32 = 0.005;             // contact slop, avoids jitter at rest

// Static object types (mirrors assembly/physics.ts)
const TYPE_MUSHROOM: i32 = 1;
const TYPE_CLOUD: i32 = 2;
const TYPE_GATE: i32 = 3;
const TYPE_TRAMPOLINE: i32 = 4;
const TYPE_DYNAMIC_FERN: i32 = 5;

// -----------------------------------------------------------------------------
// Pool state
// -----------------------------------------------------------------------------
let _bodies: StaticArray<f32> | null = null;
let _capacity: i32 = 0;
let _highWater: i32 = 0;   // highest slot index ever used + 1 (iteration bound)
let _liveCount: i32 = 0;
let _awakeCount: i32 = 0;

// One-way kinematic player proxy
let _playerActive: bool = false;
let _playerX: f32 = 0.0;
let _playerY: f32 = 0.0;
let _playerZ: f32 = 0.0;
let _playerRadius: f32 = 0.5;
let _playerHeight: f32 = 1.8;
let _playerVX: f32 = 0.0;
let _playerVY: f32 = 0.0;
let _playerVZ: f32 = 0.0;

// @ts-ignore: AssemblyScript inline decorator
@inline
function pool(): StaticArray<f32> {
  return _bodies as StaticArray<f32>;
}

// @ts-ignore
@inline
function base(id: i32): i32 {
  return id * FLOATS_PER_BODY;
}

// @ts-ignore
@inline
function isUsable(id: i32): bool {
  if (_bodies === null || id < 0 || id >= _capacity) return false;
  const f = i32(unchecked(pool()[base(id) + F_FLAGS]));
  return (f & FLAG_ACTIVE) != 0;
}

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

/**
 * Allocate (once) and reset the body pool.
 * @returns byte pointer to the pool, for a zero-copy Float32Array view in JS.
 *          The view holds MAX_DYNAMIC_BODIES * 16 floats.
 */
export function initRigidBodySystem(): i32 {
  if (_bodies === null) {
    _capacity = MAX_DYNAMIC_BODIES;
    _bodies = new StaticArray<f32>(_capacity * FLOATS_PER_BODY);
  }
  const p = pool();
  for (let i = 0; i < _capacity * FLOATS_PER_BODY; i++) {
    unchecked(p[i] = 0.0);
  }
  _highWater = 0;
  _liveCount = 0;
  _awakeCount = 0;
  _playerActive = false;

  // Hand the pool over to the joint layer, which addresses it directly. Doing
  // it here means joints are re-bound (and cleared) on every reinit, so a stale
  // constraint can never survive a world rebuild.
  initJointSystem(changetype<usize>(_bodies));

  return changetype<i32>(_bodies);
}

/** Maximum simultaneous bodies (compile-time budget). */
export function rbCapacity(): i32 {
  return MAX_DYNAMIC_BODIES;
}

/** Number of live (spawned, not despawned) bodies. */
export function rbCount(): i32 {
  return _liveCount;
}

/** Number of bodies that were awake at the end of the last step. */
export function rbAwakeCount(): i32 {
  return _awakeCount;
}

/**
 * Spawn a dynamic body.
 * @param shape RB_SHAPE_SPHERE | RB_SHAPE_CAPSULE | RB_SHAPE_BOX
 * @param mass  kg; <= 0 marks the body kinematic (infinite mass)
 * @param d1/d2/d3 collider dims: sphere(radius), capsule(radius, halfHeight),
 *                 box(halfX, halfY, halfZ)
 * @param userId opaque handle the TS bridge maps back to a Three.js object
 * @returns body id, or -1 when the pool is full
 */
export function rbSpawn(
  shape: i32,
  x: f32,
  y: f32,
  z: f32,
  mass: f32,
  restitution: f32,
  friction: f32,
  d1: f32,
  d2: f32,
  d3: f32,
  userId: i32
): i32 {
  if (_bodies === null) initRigidBodySystem();
  const p = pool();

  let id: i32 = -1;
  for (let i = 0; i < _capacity; i++) {
    if ((i32(unchecked(p[base(i) + F_FLAGS])) & FLAG_ACTIVE) == 0) {
      id = i;
      break;
    }
  }
  if (id < 0) return -1;

  const b = base(id);
  unchecked(p[b + F_PX] = clampf(x, RB_MIN_X, RB_MAX_X));
  unchecked(p[b + F_PY] = clampf(y, RB_MIN_Y, RB_MAX_Y));
  unchecked(p[b + F_PZ] = clampf(z, RB_MIN_Z, RB_MAX_Z));
  unchecked(p[b + F_VX] = 0.0);
  unchecked(p[b + F_VY] = 0.0);
  unchecked(p[b + F_VZ] = 0.0);

  const kinematic = mass <= 0.0;
  unchecked(p[b + F_INV_MASS] = kinematic ? 0.0 : 1.0 / mass);
  unchecked(p[b + F_RESTITUTION] = clampf(restitution, 0.0, 0.95));
  unchecked(p[b + F_FRICTION] = clampf(friction, 0.0, 1.0));

  // Guard against degenerate colliders — a zero-extent shape makes the
  // penetration normal undefined and the solver explodes.
  unchecked(p[b + F_D1] = Mathf.max(d1, 0.01));
  unchecked(p[b + F_D2] = Mathf.max(d2, 0.01));
  unchecked(p[b + F_D3] = Mathf.max(d3, 0.01));

  unchecked(p[b + F_SHAPE] = f32(shape));
  unchecked(p[b + F_FLAGS] = f32(FLAG_ACTIVE | (kinematic ? FLAG_KINEMATIC : 0)));
  unchecked(p[b + F_SLEEP] = 0.0);
  unchecked(p[b + F_USER] = f32(userId));

  if (id >= _highWater) _highWater = id + 1;
  _liveCount++;
  return id;
}

/** Free a body slot. Safe to call on an already-free id. */
export function rbDespawn(id: i32): void {
  if (!isUsable(id)) return;
  // Drop constraints first: a joint must never outlive its endpoint and start
  // pulling on a recycled slot.
  jointsOnBodyRemoved(id);
  const p = pool();
  const b = base(id);
  for (let i = 0; i < FLOATS_PER_BODY; i++) unchecked(p[b + i] = 0.0);
  _liveCount--;
  if (id == _highWater - 1) {
    // Shrink the iteration bound past any trailing free slots.
    let hw = _highWater;
    while (hw > 0 && (i32(unchecked(p[base(hw - 1) + F_FLAGS])) & FLAG_ACTIVE) == 0) hw--;
    _highWater = hw;
  }
}

/** Despawn every body (keeps the allocation). */
export function rbClear(): void {
  if (_bodies === null) return;
  jointsClear();
  const p = pool();
  for (let i = 0; i < _capacity * FLOATS_PER_BODY; i++) unchecked(p[i] = 0.0);
  _highWater = 0;
  _liveCount = 0;
  _awakeCount = 0;
}

// -----------------------------------------------------------------------------
// Mutators
// -----------------------------------------------------------------------------

export function rbSetPosition(id: i32, x: f32, y: f32, z: f32): void {
  if (!isUsable(id)) return;
  const p = pool();
  const b = base(id);
  unchecked(p[b + F_PX] = clampf(x, RB_MIN_X, RB_MAX_X));
  unchecked(p[b + F_PY] = clampf(y, RB_MIN_Y, RB_MAX_Y));
  unchecked(p[b + F_PZ] = clampf(z, RB_MIN_Z, RB_MAX_Z));
  wake(p, b);
}

export function rbSetVelocity(id: i32, vx: f32, vy: f32, vz: f32): void {
  if (!isUsable(id)) return;
  const p = pool();
  const b = base(id);
  unchecked(p[b + F_VX] = vx);
  unchecked(p[b + F_VY] = vy);
  unchecked(p[b + F_VZ] = vz);
  wake(p, b);
}

/** Apply an instantaneous impulse (mass-scaled). No-op on kinematic bodies. */
export function rbApplyImpulse(id: i32, ix: f32, iy: f32, iz: f32): void {
  if (!isUsable(id)) return;
  const p = pool();
  const b = base(id);
  const invMass = unchecked(p[b + F_INV_MASS]);
  if (invMass <= 0.0) return;
  unchecked(p[b + F_VX] += ix * invMass);
  unchecked(p[b + F_VY] += iy * invMass);
  unchecked(p[b + F_VZ] += iz * invMass);
  wake(p, b);
}

/**
 * Explosion-style radial impulse — the hook for ability hits
 * (rainbow blaster, glitch grenade).
 * @returns number of bodies affected
 */
export function rbApplyRadialImpulse(
  x: f32,
  y: f32,
  z: f32,
  radius: f32,
  strength: f32,
  upBias: f32
): i32 {
  if (_bodies === null || radius <= 0.0) return 0;
  const p = pool();
  const rSq = radius * radius;
  let hit = 0;

  for (let id = 0; id < _highWater; id++) {
    const b = base(id);
    const flags = i32(unchecked(p[b + F_FLAGS]));
    if ((flags & FLAG_ACTIVE) == 0) continue;
    const invMass = unchecked(p[b + F_INV_MASS]);
    if (invMass <= 0.0) continue;

    const dx = unchecked(p[b + F_PX]) - x;
    const dy = unchecked(p[b + F_PY]) - y;
    const dz = unchecked(p[b + F_PZ]) - z;
    const dSq = dx * dx + dy * dy + dz * dz;
    if (dSq > rSq) continue;

    const dist = Mathf.sqrt(dSq);
    // Linear falloff; at the epicentre push straight up rather than dividing
    // by ~0 and producing a NaN direction.
    const falloff: f32 = 1.0 - dist / radius;
    let nx: f32 = 0.0, ny: f32 = 1.0, nz: f32 = 0.0;
    if (dist > 1e-4) {
      nx = dx / dist;
      ny = dy / dist + upBias;
      nz = dz / dist;
      const nl = Mathf.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl > 1e-4) { nx /= nl; ny /= nl; nz /= nl; }
    }

    const j: f32 = strength * falloff * invMass;
    unchecked(p[b + F_VX] += nx * j);
    unchecked(p[b + F_VY] += ny * j);
    unchecked(p[b + F_VZ] += nz * j);
    wake(p, b);
    hit++;
  }
  return hit;
}

/**
 * Publish the player capsule so bodies can be bumped by it. One-way: the
 * player controller is never modified from here.
 * @param y feet-to-eye top of the capsule (same convention as PLAYER_STATE)
 */
export function rbSetPlayerProxy(
  x: f32,
  y: f32,
  z: f32,
  radius: f32,
  height: f32,
  vx: f32,
  vy: f32,
  vz: f32
): void {
  _playerActive = true;
  _playerX = x;
  _playerY = y;
  _playerZ = z;
  _playerRadius = Mathf.max(radius, 0.05);
  _playerHeight = Mathf.max(height, 0.1);
  _playerVX = vx;
  _playerVY = vy;
  _playerVZ = vz;
}

export function rbDisablePlayerProxy(): void {
  _playerActive = false;
}

// -----------------------------------------------------------------------------
// Accessors (single-body reads; bulk reads go through the shared view)
// -----------------------------------------------------------------------------

export function rbGetPositionX(id: i32): f32 {
  return isUsable(id) ? unchecked(pool()[base(id) + F_PX]) : 0.0;
}
export function rbGetPositionY(id: i32): f32 {
  return isUsable(id) ? unchecked(pool()[base(id) + F_PY]) : 0.0;
}
export function rbGetPositionZ(id: i32): f32 {
  return isUsable(id) ? unchecked(pool()[base(id) + F_PZ]) : 0.0;
}
export function rbIsSleeping(id: i32): i32 {
  if (!isUsable(id)) return 0;
  return (i32(unchecked(pool()[base(id) + F_FLAGS])) & FLAG_SLEEPING) != 0 ? 1 : 0;
}
export function rbIsGrounded(id: i32): i32 {
  if (!isUsable(id)) return 0;
  return (i32(unchecked(pool()[base(id) + F_FLAGS])) & FLAG_GROUNDED) != 0 ? 1 : 0;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// @ts-ignore
@inline
function clampf(v: f32, lo: f32, hi: f32): f32 {
  return v < lo ? lo : (v > hi ? hi : v);
}

// @ts-ignore
@inline
function wake(p: StaticArray<f32>, b: i32): void {
  const flags = i32(unchecked(p[b + F_FLAGS]));
  if ((flags & FLAG_SLEEPING) != 0) {
    unchecked(p[b + F_FLAGS] = f32(flags & ~FLAG_SLEEPING));
  }
  unchecked(p[b + F_SLEEP] = 0.0);
}

/** Distance from the body origin down to the lowest point of its collider. */
// @ts-ignore
@inline
function bottomExtent(shape: i32, d1: f32, d2: f32): f32 {
  if (shape == RB_SHAPE_SPHERE) return d1;
  if (shape == RB_SHAPE_CAPSULE) return d2 + d1;
  return d2; // box half-Y
}

/** Half-extent on the horizontal plane (conservative). */
// @ts-ignore
@inline
function lateralExtent(shape: i32, d1: f32, d3: f32): f32 {
  if (shape == RB_SHAPE_BOX) return Mathf.max(d1, d3);
  return d1;
}

/** Bounding-sphere radius, used for the body-body broad+narrow phase. */
// @ts-ignore
@inline
function boundingRadius(shape: i32, d1: f32, d2: f32, d3: f32): f32 {
  if (shape == RB_SHAPE_SPHERE) return d1;
  if (shape == RB_SHAPE_CAPSULE) return d2 + d1;
  return Mathf.sqrt(d1 * d1 + d2 * d2 + d3 * d3);
}

// -----------------------------------------------------------------------------
// Simulation
// -----------------------------------------------------------------------------

/**
 * Advance the dynamic bodies.
 *
 * @param dt    frame delta in seconds (clamped and split into fixed substeps)
 * @param nowMs performance.now(), forwarded to the unified ground height cache
 * @returns number of bodies awake after the step (0 => nothing to sync)
 */
export function stepRigidBodies(dt: f32, nowMs: f64): i32 {
  if (_bodies === null || _liveCount == 0) {
    _awakeCount = 0;
    return 0;
  }

  let remaining = clampf(dt, 0.0, MAX_FRAME_DT);
  if (remaining <= 0.0) return _awakeCount;

  let steps = 0;
  while (remaining > 1e-6 && steps < MAX_SUBSTEPS) {
    const h = remaining > MAX_SUBSTEP ? MAX_SUBSTEP : remaining;
    substep(h, nowMs);
    remaining -= h;
    steps++;
  }

  // Count awake bodies once, after the last substep.
  const p = pool();
  let awake = 0;
  for (let id = 0; id < _highWater; id++) {
    const b = base(id);
    const flags = i32(unchecked(p[b + F_FLAGS]));
    if ((flags & FLAG_ACTIVE) == 0) continue;
    if ((flags & FLAG_SLEEPING) == 0) awake++;
  }
  _awakeCount = awake;
  return awake;
}

function substep(h: f32, nowMs: f64): void {
  const p = pool();

  // --- 1. Integrate + environment contacts ---------------------------------
  const damping = clampf(1.0 - LINEAR_DAMPING * h, 0.0, 1.0);

  for (let id = 0; id < _highWater; id++) {
    const b = base(id);
    const flags = i32(unchecked(p[b + F_FLAGS]));
    if ((flags & FLAG_ACTIVE) == 0) continue;
    if ((flags & FLAG_SLEEPING) != 0) continue;
    if ((flags & FLAG_KINEMATIC) != 0) {
      // Kinematic bodies are moved by gameplay code; just carry position.
      unchecked(p[b + F_PX] += unchecked(p[b + F_VX]) * h);
      unchecked(p[b + F_PY] += unchecked(p[b + F_VY]) * h);
      unchecked(p[b + F_PZ] += unchecked(p[b + F_VZ]) * h);
      clampToWorld(p, b);
      continue;
    }

    let vx = unchecked(p[b + F_VX]);
    let vy = unchecked(p[b + F_VY]) + GRAVITY * h;
    let vz = unchecked(p[b + F_VZ]);

    vx *= damping;
    vy *= damping;
    vz *= damping;

    // Speed clamp keeps a bad impulse from tunnelling a body out of the world.
    const spSq = vx * vx + vy * vy + vz * vz;
    if (spSq > MAX_SPEED * MAX_SPEED) {
      const s = MAX_SPEED / Mathf.sqrt(spSq);
      vx *= s; vy *= s; vz *= s;
    }

    unchecked(p[b + F_PX] += vx * h);
    unchecked(p[b + F_PY] += vy * h);
    unchecked(p[b + F_PZ] += vz * h);
    unchecked(p[b + F_VX] = vx);
    unchecked(p[b + F_VY] = vy);
    unchecked(p[b + F_VZ] = vz);

    // Clear the grounded flag; the contact passes below re-set it.
    unchecked(p[b + F_FLAGS] = f32(i32(unchecked(p[b + F_FLAGS])) & ~FLAG_GROUNDED));

    resolveWorldBounds(p, b);
    resolveTerrain(p, b, nowMs);
    resolveStaticObjects(p, b);
  }

  // --- 2. Joints ------------------------------------------------------------
  // After integration and environment contacts, before body-body: a constraint
  // wins over gravity for the substep, and a contact still gets the last word
  // on penetration. No-op while no joints exist.
  solveJoints(h);

  // --- 3. Body vs body ------------------------------------------------------
  resolveBodyPairs(p);

  // --- 4. Player proxy (one-way) -------------------------------------------
  if (_playerActive) resolvePlayerProxy(p);

  // --- 5. Bounds safety net + sleep bookkeeping ----------------------------
  for (let id = 0; id < _highWater; id++) {
    const b = base(id);
    const flags = i32(unchecked(p[b + F_FLAGS]));
    if ((flags & FLAG_ACTIVE) == 0) continue;

    // Sanitise: a NaN anywhere would poison every later contact. Recycle the
    // body to the world centre rather than letting it corrupt the sim.
    if (!isFinitef(unchecked(p[b + F_PX])) ||
        !isFinitef(unchecked(p[b + F_PY])) ||
        !isFinitef(unchecked(p[b + F_PZ])) ||
        !isFinitef(unchecked(p[b + F_VX])) ||
        !isFinitef(unchecked(p[b + F_VY])) ||
        !isFinitef(unchecked(p[b + F_VZ]))) {
      unchecked(p[b + F_PX] = 0.0);
      unchecked(p[b + F_PY] = 0.0);
      unchecked(p[b + F_PZ] = 0.0);
      unchecked(p[b + F_VX] = 0.0);
      unchecked(p[b + F_VY] = 0.0);
      unchecked(p[b + F_VZ] = 0.0);
    }

    clampToWorld(p, b);
    updateSleep(p, b, h);
  }
}

// @ts-ignore
@inline
function isFinitef(v: f32): bool {
  return v == v && Mathf.abs(v) < f32.MAX_VALUE;
}

// @ts-ignore
@inline
function clampToWorld(p: StaticArray<f32>, b: i32): void {
  unchecked(p[b + F_PX] = clampf(unchecked(p[b + F_PX]), RB_MIN_X, RB_MAX_X));
  unchecked(p[b + F_PY] = clampf(unchecked(p[b + F_PY]), RB_MIN_Y, RB_MAX_Y));
  unchecked(p[b + F_PZ] = clampf(unchecked(p[b + F_PZ]), RB_MIN_Z, RB_MAX_Z));
}

/** Bounce off the world walls / ceiling so bodies can never leave the grid. */
function resolveWorldBounds(p: StaticArray<f32>, b: i32): void {
  const shape = i32(unchecked(p[b + F_SHAPE]));
  const d1 = unchecked(p[b + F_D1]);
  const d3 = unchecked(p[b + F_D3]);
  const r = lateralExtent(shape, d1, d3);
  const rest = unchecked(p[b + F_RESTITUTION]);

  let x = unchecked(p[b + F_PX]);
  let z = unchecked(p[b + F_PZ]);
  let vx = unchecked(p[b + F_VX]);
  let vz = unchecked(p[b + F_VZ]);

  if (x - r < RB_MIN_X) { x = RB_MIN_X + r; if (vx < 0.0) vx = -vx * rest; }
  else if (x + r > RB_MAX_X) { x = RB_MAX_X - r; if (vx > 0.0) vx = -vx * rest; }

  if (z - r < RB_MIN_Z) { z = RB_MIN_Z + r; if (vz < 0.0) vz = -vz * rest; }
  else if (z + r > RB_MAX_Z) { z = RB_MAX_Z - r; if (vz > 0.0) vz = -vz * rest; }

  let y = unchecked(p[b + F_PY]);
  let vy = unchecked(p[b + F_VY]);
  const top = bottomExtent(shape, d1, unchecked(p[b + F_D2]));
  if (y + top > RB_MAX_Y) { y = RB_MAX_Y - top; if (vy > 0.0) vy = -vy * rest; }

  unchecked(p[b + F_PX] = x);
  unchecked(p[b + F_PY] = y);
  unchecked(p[b + F_PZ] = z);
  unchecked(p[b + F_VX] = vx);
  unchecked(p[b + F_VZ] = vz);
  unchecked(p[b + F_VY] = vy);
}

/** Rest on the unified ground height (terrain + registered platforms + lake). */
function resolveTerrain(p: StaticArray<f32>, b: i32, nowMs: f64): void {
  const x = unchecked(p[b + F_PX]);
  const z = unchecked(p[b + F_PZ]);
  const shape = i32(unchecked(p[b + F_SHAPE]));
  const bottom = bottomExtent(shape, unchecked(p[b + F_D1]), unchecked(p[b + F_D2]));

  const groundY = getUnifiedGroundHeight(x, z, nowMs);
  const restY = groundY + bottom;

  if (unchecked(p[b + F_PY]) <= restY + SKIN) {
    landOn(p, b, restY);
  }
}

/** Shared "resolve a downward contact against a horizontal surface" step. */
function landOn(p: StaticArray<f32>, b: i32, restY: f32): void {
  unchecked(p[b + F_PY] = restY);

  const vy = unchecked(p[b + F_VY]);
  const rest = unchecked(p[b + F_RESTITUTION]);
  if (vy < 0.0) {
    const bounce = -vy * rest;
    // Below ~1 unit/s a bounce reads as jitter, not bounciness — kill it so
    // the body can actually come to rest and go to sleep.
    unchecked(p[b + F_VY] = bounce > 1.0 ? bounce : 0.0);
  }

  // Coulomb-ish tangential friction.
  const keep = clampf(1.0 - unchecked(p[b + F_FRICTION]), 0.0, 1.0);
  unchecked(p[b + F_VX] *= keep);
  unchecked(p[b + F_VZ] *= keep);

  unchecked(p[b + F_FLAGS] = f32(i32(unchecked(p[b + F_FLAGS])) | FLAG_GROUNDED));
}

/**
 * Contacts against the existing static collision grid: mushroom caps, cloud
 * platforms, trampolines (bouncy), dynamic ferns, and gate cylinders.
 * Walks the same 3x3 cell neighbourhood as resolveGameCollisions().
 */
function resolveStaticObjects(p: StaticArray<f32>, b: i32): void {
  const objCount = getCollisionObjectCount();
  if (objCount <= 0) return;

  const x = unchecked(p[b + F_PX]);
  const z = unchecked(p[b + F_PZ]);
  const shape = i32(unchecked(p[b + F_SHAPE]));
  const d1 = unchecked(p[b + F_D1]);
  const d2 = unchecked(p[b + F_D2]);
  const d3 = unchecked(p[b + F_D3]);
  const lateral = lateralExtent(shape, d1, d3);
  const bottom = bottomExtent(shape, d1, d2);

  const centerCol = i32(Mathf.floor((x - GRID_ORIGIN_X) / GRID_CELL_SIZE));
  const centerRow = i32(Mathf.floor((z - GRID_ORIGIN_Z) / GRID_CELL_SIZE));

  for (let row = centerRow - 1; row <= centerRow + 1; row++) {
    for (let col = centerCol - 1; col <= centerCol + 1; col++) {
      if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) continue;

      const gridIdx = row * GRID_COLS + col;
      let objId = load<i32>(GRID_HEADS_OFFSET + (gridIdx * 4));
      let guard = 0;

      while (objId != -1) {
        if (objId < 0 || objId >= objCount || guard >= objCount) break;
        guard++;

        const objPtr = COLLISION_OFFSET + (objId * COLLISION_STRIDE);
        const type = i32(load<f32>(objPtr));
        const ox = load<f32>(objPtr + 4);
        const oy = load<f32>(objPtr + 8);
        const oz = load<f32>(objPtr + 12);
        const od1 = load<f32>(objPtr + 16);
        const od2 = load<f32>(objPtr + 20);
        const od3 = load<f32>(objPtr + 24);

        const bx = unchecked(p[b + F_PX]);
        const bz = unchecked(p[b + F_PZ]);
        const dx = bx - ox;
        const dz = bz - oz;
        const distSq = dx * dx + dz * dz;

        if (type == TYPE_GATE) {
          // Solid vertical cylinder — push the body out laterally.
          const reach = od1 + lateral;
          if (distSq < reach * reach) {
            const dist = Mathf.sqrt(distSq);
            let nx: f32 = 1.0, nz: f32 = 0.0;
            if (dist > 1e-4) { nx = dx / dist; nz = dz / dist; }
            const pen = reach - dist;
            unchecked(p[b + F_PX] = bx + nx * pen);
            unchecked(p[b + F_PZ] = bz + nz * pen);
            // Reflect only the inward component of the velocity.
            const vn = unchecked(p[b + F_VX]) * nx + unchecked(p[b + F_VZ]) * nz;
            if (vn < 0.0) {
              const j: f32 = -vn * (<f32>1.0 + unchecked(p[b + F_RESTITUTION]));
              unchecked(p[b + F_VX] += nx * j);
              unchecked(p[b + F_VZ] += nz * j);
            }
          }
        } else if (unchecked(p[b + F_VY]) <= 0.0) {
          // Landable caps. Mirrors the player's surface heuristics so a prop
          // rests exactly where the player would stand.
          let surfaceY: f32 = 0.0;
          let capRadius: f32 = 0.0;

          if (type == TYPE_MUSHROOM || type == TYPE_TRAMPOLINE) {
            surfaceY = oy + od2;
            capRadius = od1;
          } else if (type == TYPE_DYNAMIC_FERN) {
            const dynIdx = i32(od3);
            let r = load<f32>(DYNAMIC_RADII_OFFSET + (dynIdx * 4));
            if (r < 2.0) r = 2.0; // closed fern still has a base
            surfaceY = oy + od2;
            capRadius = r;
          } else if (type == TYPE_CLOUD) {
            surfaceY = oy + od2 * 0.8;
            capRadius = od1 * 2.0;
          } else {
            objId = load<i32>(GRID_NEXT_OFFSET + (objId * 4));
            continue;
          }

          const reach = capRadius + lateral;
          if (distSq < reach * reach) {
            const restY = surfaceY + bottom;
            // Only snap when we are near the cap, not teleporting up a stalk.
            if (unchecked(p[b + F_PY]) <= restY + SKIN &&
                unchecked(p[b + F_PY]) >= restY - 2.0) {
              if (type == TYPE_TRAMPOLINE) {
                unchecked(p[b + F_PY] = restY);
                unchecked(p[b + F_VY] = 14.0);
                wake(p, b);
              } else {
                landOn(p, b, restY);
              }
            }
          }
        }

        objId = load<i32>(GRID_NEXT_OFFSET + (objId * 4));
      }
    }
  }
}

/**
 * Body-body contacts as bounding spheres. O(n^2) over the high-water mark;
 * at MAX_DYNAMIC_BODIES = 64 that is ~2016 pairs of pure f32 math per substep,
 * which is cheaper than maintaining a second broadphase for this few objects.
 */
function resolveBodyPairs(p: StaticArray<f32>): void {
  for (let i = 0; i < _highWater; i++) {
    const bi = base(i);
    const fi = i32(unchecked(p[bi + F_FLAGS]));
    if ((fi & FLAG_ACTIVE) == 0) continue;

    const ri = boundingRadius(
      i32(unchecked(p[bi + F_SHAPE])),
      unchecked(p[bi + F_D1]), unchecked(p[bi + F_D2]), unchecked(p[bi + F_D3])
    );

    for (let j = i + 1; j < _highWater; j++) {
      const bj = base(j);
      const fj = i32(unchecked(p[bj + F_FLAGS]));
      if ((fj & FLAG_ACTIVE) == 0) continue;

      // Two sleeping bodies cannot start interacting on their own.
      if ((fi & FLAG_SLEEPING) != 0 && (fj & FLAG_SLEEPING) != 0) continue;

      const invI = unchecked(p[bi + F_INV_MASS]);
      const invJ = unchecked(p[bj + F_INV_MASS]);
      const invSum = invI + invJ;
      if (invSum <= 0.0) continue; // two kinematic bodies

      const rj = boundingRadius(
        i32(unchecked(p[bj + F_SHAPE])),
        unchecked(p[bj + F_D1]), unchecked(p[bj + F_D2]), unchecked(p[bj + F_D3])
      );

      let dx = unchecked(p[bj + F_PX]) - unchecked(p[bi + F_PX]);
      let dy = unchecked(p[bj + F_PY]) - unchecked(p[bi + F_PY]);
      let dz = unchecked(p[bj + F_PZ]) - unchecked(p[bi + F_PZ]);
      const sum = ri + rj;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq >= sum * sum) continue;

      const dist = Mathf.sqrt(dSq);
      let nx: f32, ny: f32, nz: f32;
      if (dist > 1e-4) {
        nx = dx / dist; ny = dy / dist; nz = dz / dist;
      } else {
        // Perfectly coincident centres: pick an arbitrary axis so the pair
        // separates instead of producing a 0/0 normal.
        nx = 0.0; ny = 1.0; nz = 0.0;
      }

      // Positional correction, split by inverse mass.
      const pen = sum - dist;
      const ci = pen * (invI / invSum);
      const cj = pen * (invJ / invSum);
      unchecked(p[bi + F_PX] -= nx * ci);
      unchecked(p[bi + F_PY] -= ny * ci);
      unchecked(p[bi + F_PZ] -= nz * ci);
      unchecked(p[bj + F_PX] += nx * cj);
      unchecked(p[bj + F_PY] += ny * cj);
      unchecked(p[bj + F_PZ] += nz * cj);

      // Impulse along the normal.
      const rvx = unchecked(p[bj + F_VX]) - unchecked(p[bi + F_VX]);
      const rvy = unchecked(p[bj + F_VY]) - unchecked(p[bi + F_VY]);
      const rvz = unchecked(p[bj + F_VZ]) - unchecked(p[bi + F_VZ]);
      const vn = rvx * nx + rvy * ny + rvz * nz;
      if (vn < 0.0) {
        const e = Mathf.min(unchecked(p[bi + F_RESTITUTION]), unchecked(p[bj + F_RESTITUTION]));
        const jImp: f32 = -(<f32>1.0 + e) * vn / invSum;
        unchecked(p[bi + F_VX] -= nx * jImp * invI);
        unchecked(p[bi + F_VY] -= ny * jImp * invI);
        unchecked(p[bi + F_VZ] -= nz * jImp * invI);
        unchecked(p[bj + F_VX] += nx * jImp * invJ);
        unchecked(p[bj + F_VY] += ny * jImp * invJ);
        unchecked(p[bj + F_VZ] += nz * jImp * invJ);
      }

      wake(p, bi);
      wake(p, bj);
    }
  }
}

/**
 * Player capsule vs bodies. Strictly one-way — we never write back to the
 * player state, so the character controller keeps full authority over jump,
 * dash and grounding.
 */
function resolvePlayerProxy(p: StaticArray<f32>): void {
  const capTop = _playerY;
  const capBottom = _playerY - _playerHeight;

  for (let id = 0; id < _highWater; id++) {
    const b = base(id);
    const flags = i32(unchecked(p[b + F_FLAGS]));
    if ((flags & FLAG_ACTIVE) == 0) continue;
    const invMass = unchecked(p[b + F_INV_MASS]);
    if (invMass <= 0.0) continue;

    const bx = unchecked(p[b + F_PX]);
    const by = unchecked(p[b + F_PY]);
    const bz = unchecked(p[b + F_PZ]);
    const r = boundingRadius(
      i32(unchecked(p[b + F_SHAPE])),
      unchecked(p[b + F_D1]), unchecked(p[b + F_D2]), unchecked(p[b + F_D3])
    );

    // Closest point on the player's capsule segment to the body centre.
    const cy = clampf(by, capBottom, capTop);
    const dx = bx - _playerX;
    const dy = by - cy;
    const dz = bz - _playerZ;
    const sum = r + _playerRadius;
    const dSq = dx * dx + dy * dy + dz * dz;
    if (dSq >= sum * sum) continue;

    const dist = Mathf.sqrt(dSq);
    let nx: f32 = 1.0, ny: f32 = 0.0, nz: f32 = 0.0;
    if (dist > 1e-4) { nx = dx / dist; ny = dy / dist; nz = dz / dist; }

    // Push the body fully out (the player is immovable here).
    const pen = sum - dist;
    unchecked(p[b + F_PX] = bx + nx * pen);
    unchecked(p[b + F_PY] = by + ny * pen);
    unchecked(p[b + F_PZ] = bz + nz * pen);

    // Transfer the player's approach speed so walking into a prop nudges it.
    const relN = (unchecked(p[b + F_VX]) - _playerVX) * nx +
                 (unchecked(p[b + F_VY]) - _playerVY) * ny +
                 (unchecked(p[b + F_VZ]) - _playerVZ) * nz;
    if (relN < 0.0) {
      const e = unchecked(p[b + F_RESTITUTION]);
      const jImp: f32 = -(<f32>1.0 + e) * relN;
      unchecked(p[b + F_VX] += nx * jImp);
      unchecked(p[b + F_VY] += ny * jImp);
      unchecked(p[b + F_VZ] += nz * jImp);
    }
    wake(p, b);
  }
}

/** Put slow, grounded bodies to sleep so idle props cost nothing to sync. */
function updateSleep(p: StaticArray<f32>, b: i32, h: f32): void {
  const flags = i32(unchecked(p[b + F_FLAGS]));
  if ((flags & FLAG_KINEMATIC) != 0) return;

  const vx = unchecked(p[b + F_VX]);
  const vy = unchecked(p[b + F_VY]);
  const vz = unchecked(p[b + F_VZ]);
  const speedSq = vx * vx + vy * vy + vz * vz;

  if ((flags & FLAG_SLEEPING) != 0) {
    if (speedSq > WAKE_SPEED * WAKE_SPEED) {
      unchecked(p[b + F_FLAGS] = f32(flags & ~FLAG_SLEEPING));
      unchecked(p[b + F_SLEEP] = 0.0);
    } else {
      // Hold it still; gravity keeps accumulating otherwise.
      unchecked(p[b + F_VX] = 0.0);
      unchecked(p[b + F_VY] = 0.0);
      unchecked(p[b + F_VZ] = 0.0);
    }
    return;
  }

  const settled = speedSq < SLEEP_LINEAR_SPEED * SLEEP_LINEAR_SPEED &&
                  (flags & FLAG_GROUNDED) != 0;
  if (settled) {
    const t = unchecked(p[b + F_SLEEP]) + h;
    unchecked(p[b + F_SLEEP] = t);
    if (t >= SLEEP_TIME) {
      unchecked(p[b + F_FLAGS] = f32(flags | FLAG_SLEEPING));
      unchecked(p[b + F_VX] = 0.0);
      unchecked(p[b + F_VY] = 0.0);
      unchecked(p[b + F_VZ] = 0.0);
    }
  } else {
    unchecked(p[b + F_SLEEP] = 0.0);
  }
}
