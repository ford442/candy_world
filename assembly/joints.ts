// assembly/joints.ts
//
// Basic joints on top of the dynamic rigid-body layer (assembly/rigidbody.ts):
// fixed, hinge (1 axis) and spring (distance). Enough for a candy swing, a
// hanging gumdrop, a trap lid, or a bouncing-pad linkage.
//
// Scope, on purpose:
//   - three joint types, no generic D6, no ragdolls, no cloth, no motors
//   - a small fixed iteration count, no islands, no graph colouring
//   - anchors are points; the body layer carries no angular state, so a joint
//     constrains *positions* only
//
// Because bodies have no rotation, a "hinge" here is a point-to-point rod plus
// a plane restriction: body B is held at a fixed arm length from the pivot and
// confined to the plane through the pivot whose normal is the hinge axis. That
// is exactly one rotational degree of freedom about the axis — a swing — which
// is what the interactive toys need. A zero-length arm degenerates to a pin.
//
// Solver: position-based (PBD). Each substep runs JOINT_ITERATIONS projection
// passes, then converts the accumulated positional correction back into
// velocity as `v += dp / h`. That is the standard PBD velocity update and it is
// exactly consistent with the caller's semi-implicit Euler integrator: after
// integration p = p0 + v*h, so (p_final - p0) / h == v + dp/h. Springs are soft
// and stay at the velocity level (explicit force, clamped for stability).
//
// Memory: the joint pool is a managed StaticArray<f32>, like the body pool, so
// it can never overlap the hand-rolled offsets in constants.ts.
//
// Module direction is strictly rigidbody.ts -> joints.ts (never the reverse):
// the body pool is handed over as a raw pointer by initJointSystem() and read
// with load/store, the same way physics.ts walks the collision block.

import {
  MAX_JOINTS,
  JOINT_STRIDE,
  MAX_DYNAMIC_BODIES,
  RB_FLOATS_PER_BODY,
  RB_F_PX,
  RB_F_PY,
  RB_F_PZ,
  RB_F_VX,
  RB_F_VY,
  RB_F_VZ,
  RB_F_INV_MASS,
  RB_F_FLAGS,
  RB_F_SLEEP,
  RB_FLAG_ACTIVE,
  RB_FLAG_SLEEPING,
} from './constants';

// -----------------------------------------------------------------------------
// Layout — 16 f32 per joint (JOINT_STRIDE = 64 bytes)
// -----------------------------------------------------------------------------
const FLOATS_PER_JOINT: i32 = JOINT_STRIDE / 4;

const J_TYPE: i32 = 0;
const J_BODY_A: i32 = 1;   // body id, or -1 to anchor against the world
const J_BODY_B: i32 = 2;
const J_AX: i32 = 3;       // anchor on A: A-local offset, or world point when A == -1
const J_AY: i32 = 4;
const J_AZ: i32 = 5;
const J_BX: i32 = 6;       // anchor on B: B-local offset, or world point when B == -1
const J_BY: i32 = 7;
const J_BZ: i32 = 8;
const J_P0: i32 = 9;       // hinge: axis x  | spring: rest length
const J_P1: i32 = 10;      // hinge: axis y  | spring: stiffness k
const J_P2: i32 = 11;      // hinge: axis z  | spring: damping
const J_P3: i32 = 12;      // hinge: arm length (pivot -> B anchor at bind time)
const J_FLAGS: i32 = 13;
const J_SOFTNESS: i32 = 14; // 0 = rigid .. 0.95 = very loose (fixed/hinge only)
const J_USER: i32 = 15;     // opaque handle owned by the TS bridge

/** Joint types. Mirrored by JOINT_TYPE in src/systems/physics/joint-types.ts. */
export const JOINT_FIXED: i32 = 0;
export const JOINT_HINGE: i32 = 1;
export const JOINT_SPRING: i32 = 2;

const JFLAG_ACTIVE: i32 = 1;

// -----------------------------------------------------------------------------
// Tuning
// -----------------------------------------------------------------------------
/** Projection passes per substep. 4 @ 1/120s is ample for chains of 1-2 links. */
const JOINT_ITERATIONS: i32 = 4;

/** Per-iteration correction clamp (metres). Stops a badly-placed joint from
 *  teleporting a body across the map on its first solve. */
const MAX_CORRECTION: f32 = 2.0;

/** Speed cap on anything a joint writes, in u/s. Below the body layer's
 *  MAX_SPEED (80) so a constraint can never be the thing that explodes, and low
 *  enough that a substep's travel stays under a body radius. */
const MAX_JOINT_SPEED: f32 = 60.0;

/** Documented stiffness / damping ranges — see docs/PERF_BUDGETS.md. Values are
 *  clamped here, so an out-of-range k is soft-limited rather than divergent. */
export const SPRING_MAX_STIFFNESS: f32 = 4000.0;
export const SPRING_MAX_DAMPING: f32 = 400.0;

/** Corrections smaller than this neither wake a body nor count as work. */
const SETTLE_EPS: f32 = 1e-5;

// -----------------------------------------------------------------------------
// Pool state
// -----------------------------------------------------------------------------
let _joints: StaticArray<f32> | null = null;
let _deltas: StaticArray<f32> | null = null;  // MAX_DYNAMIC_BODIES * 3, PBD dp
let _touched: StaticArray<i32> | null = null; // per-body "was corrected" marks

let _bodyPtr: usize = 0;      // raw pointer to the rigid-body pool
let _highWater: i32 = 0;      // highest joint slot ever used + 1
let _liveCount: i32 = 0;

// @ts-ignore: AssemblyScript inline decorator
@inline
function jpool(): StaticArray<f32> {
  return _joints as StaticArray<f32>;
}

// @ts-ignore
@inline
function jbase(id: i32): i32 {
  return id * FLOATS_PER_JOINT;
}

// @ts-ignore
@inline
function jointUsable(id: i32): bool {
  if (_joints === null || id < 0 || id >= MAX_JOINTS) return false;
  return (i32(unchecked(jpool()[jbase(id) + J_FLAGS])) & JFLAG_ACTIVE) != 0;
}

// --- raw body-pool access ----------------------------------------------------
// The pool is a non-moving managed StaticArray whose pointer rigidbody.ts also
// hands to JS for a zero-copy view, so addressing it directly is safe here.

// @ts-ignore
@inline
function bget(id: i32, f: i32): f32 {
  return load<f32>(_bodyPtr + (((id * RB_FLOATS_PER_BODY) + f) << 2));
}

// @ts-ignore
@inline
function bset(id: i32, f: i32, v: f32): void {
  store<f32>(_bodyPtr + (((id * RB_FLOATS_PER_BODY) + f) << 2), v);
}

/** Inverse mass, or 0 for kinematic/world/despawned — i.e. "immovable". */
// @ts-ignore
@inline
function invMassOf(id: i32): f32 {
  if (id < 0) return 0.0; // the world anchor
  return bget(id, RB_F_INV_MASS);
}

/** True when the id names a live body (or the world, which is always valid). */
// @ts-ignore
@inline
function bodyRefValid(id: i32): bool {
  if (id < 0) return true;
  if (_bodyPtr == 0 || id >= MAX_DYNAMIC_BODIES) return false;
  return (i32(bget(id, RB_F_FLAGS)) & RB_FLAG_ACTIVE) != 0;
}

// @ts-ignore
@inline
function clampf(v: f32, lo: f32, hi: f32): f32 {
  return v < lo ? lo : (v > hi ? hi : v);
}

// @ts-ignore
@inline
function isFinitef(v: f32): bool {
  return v == v && Mathf.abs(v) < f32.MAX_VALUE;
}

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

/**
 * Allocate (once) and reset the joint pool.
 *
 * @param bodyPoolPtr byte pointer to the rigid-body pool, as returned by
 *                    initRigidBodySystem(). Pass 0 to run with no body pool
 *                    bound (every create then fails, which is how the layer
 *                    stays disabled when rigid bodies are off).
 * @returns byte pointer to the joint pool, for a zero-copy Float32Array view in
 *          JS. The view holds MAX_JOINTS * 16 floats.
 */
export function initJointSystem(bodyPoolPtr: usize): i32 {
  if (_joints === null) {
    _joints = new StaticArray<f32>(MAX_JOINTS * FLOATS_PER_JOINT);
    _deltas = new StaticArray<f32>(MAX_DYNAMIC_BODIES * 3);
    _touched = new StaticArray<i32>(MAX_DYNAMIC_BODIES);
  }
  const p = jpool();
  for (let i = 0; i < MAX_JOINTS * FLOATS_PER_JOINT; i++) unchecked(p[i] = 0.0);

  _bodyPtr = bodyPoolPtr;
  _highWater = 0;
  _liveCount = 0;
  return changetype<i32>(_joints);
}

/**
 * Byte pointer to the joint pool, for a zero-copy Float32Array view in JS.
 * 0 until initJointSystem() has run (which initRigidBodySystem() does for you).
 */
export function jointPoolPointer(): i32 {
  return _joints === null ? 0 : changetype<i32>(_joints);
}

/** Exclusive upper bound of occupied joint slots — for iteration in overlays. */
export function jointHighWater(): i32 {
  return _highWater;
}

/** Maximum simultaneous joints (compile-time budget). */
export function jointCapacity(): i32 {
  return MAX_JOINTS;
}

/** Number of live joints. */
export function jointCount(): i32 {
  return _liveCount;
}

/**
 * Create a joint. Anchors are given in **world space** and stored relative to
 * their body, so the joint holds whatever configuration existed at bind time.
 *
 * @param type      JOINT_FIXED | JOINT_HINGE | JOINT_SPRING
 * @param bodyA     body id, or -1 to anchor against the world
 * @param bodyB     body id, or -1 to anchor against the world
 * @param ax/ay/az  world anchor on A (the hinge pivot, for JOINT_HINGE)
 * @param bx/by/bz  world anchor on B
 * @param p0/p1/p2  hinge: axis xyz | spring: rest length, stiffness, damping
 *                  (a negative spring rest length means "use the current
 *                  anchor separation")
 * @returns joint id, or -1 when the pool is full, the body refs are invalid, or
 *          both ends are immovable (nothing to solve)
 */
export function jointCreate(
  type: i32,
  bodyA: i32,
  bodyB: i32,
  ax: f32,
  ay: f32,
  az: f32,
  bx: f32,
  by: f32,
  bz: f32,
  p0: f32,
  p1: f32,
  p2: f32
): i32 {
  if (_joints === null) return -1;
  if (type < JOINT_FIXED || type > JOINT_SPRING) return -1;
  if (!bodyRefValid(bodyA) || !bodyRefValid(bodyB)) return -1;
  // A joint needs a body on at least one end, and at least one movable end.
  if (bodyA < 0 && bodyB < 0) return -1;
  if (invMassOf(bodyA) <= 0.0 && invMassOf(bodyB) <= 0.0) return -1;
  if (!isFinitef(ax) || !isFinitef(ay) || !isFinitef(az)) return -1;
  if (!isFinitef(bx) || !isFinitef(by) || !isFinitef(bz)) return -1;

  const p = jpool();
  let id: i32 = -1;
  for (let i = 0; i < MAX_JOINTS; i++) {
    if ((i32(unchecked(p[jbase(i) + J_FLAGS])) & JFLAG_ACTIVE) == 0) {
      id = i;
      break;
    }
  }
  if (id < 0) return -1;

  const j = jbase(id);

  // World anchors -> body-local offsets (identity rotation, so a plain delta).
  let lax = ax, lay = ay, laz = az;
  if (bodyA >= 0) {
    lax -= bget(bodyA, RB_F_PX);
    lay -= bget(bodyA, RB_F_PY);
    laz -= bget(bodyA, RB_F_PZ);
  }
  let lbx = bx, lby = by, lbz = bz;
  if (bodyB >= 0) {
    lbx -= bget(bodyB, RB_F_PX);
    lby -= bget(bodyB, RB_F_PY);
    lbz -= bget(bodyB, RB_F_PZ);
  }

  unchecked(p[j + J_TYPE] = f32(type));
  unchecked(p[j + J_BODY_A] = f32(bodyA));
  unchecked(p[j + J_BODY_B] = f32(bodyB));
  unchecked(p[j + J_AX] = lax);
  unchecked(p[j + J_AY] = lay);
  unchecked(p[j + J_AZ] = laz);
  unchecked(p[j + J_BX] = lbx);
  unchecked(p[j + J_BY] = lby);
  unchecked(p[j + J_BZ] = lbz);

  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;

  if (type == JOINT_HINGE) {
    // Normalise the axis; a degenerate axis falls back to world up so the
    // joint still behaves like a swing rather than producing a NaN normal.
    let nx = p0, ny = p1, nz = p2;
    const len = Mathf.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-5) { nx /= len; ny /= len; nz /= len; }
    else { nx = 0.0; ny = 1.0; nz = 0.0; }
    unchecked(p[j + J_P0] = nx);
    unchecked(p[j + J_P1] = ny);
    unchecked(p[j + J_P2] = nz);

    // Arm length is measured *in the hinge plane*: if B starts off-plane the
    // solver slides it onto the plane rather than also changing the radius.
    const axial = dx * nx + dy * ny + dz * nz;
    const rx = dx - axial * nx;
    const ry = dy - axial * ny;
    const rz = dz - axial * nz;
    unchecked(p[j + J_P3] = Mathf.sqrt(rx * rx + ry * ry + rz * rz));
  } else if (type == JOINT_SPRING) {
    const measured = Mathf.sqrt(dx * dx + dy * dy + dz * dz);
    unchecked(p[j + J_P0] = p0 < 0.0 ? measured : Mathf.max(p0, 0.0));
    unchecked(p[j + J_P1] = clampf(p1, 0.0, SPRING_MAX_STIFFNESS));
    unchecked(p[j + J_P2] = clampf(p2, 0.0, SPRING_MAX_DAMPING));
    unchecked(p[j + J_P3] = 0.0);
  } else {
    // Fixed: the stored anchors already encode the offset to preserve.
    unchecked(p[j + J_P0] = 0.0);
    unchecked(p[j + J_P1] = 0.0);
    unchecked(p[j + J_P2] = 0.0);
    unchecked(p[j + J_P3] = 0.0);
  }

  unchecked(p[j + J_FLAGS] = f32(JFLAG_ACTIVE));
  unchecked(p[j + J_SOFTNESS] = 0.0);
  unchecked(p[j + J_USER] = 0.0);

  if (id >= _highWater) _highWater = id + 1;
  _liveCount++;
  return id;
}

/** Weld B to A, preserving their current relative offset. */
export function jointCreateFixed(bodyA: i32, bodyB: i32): i32 {
  if (!bodyRefValid(bodyA) || !bodyRefValid(bodyB) || bodyB < 0) return -1;
  const bx = bget(bodyB, RB_F_PX);
  const by = bget(bodyB, RB_F_PY);
  const bz = bget(bodyB, RB_F_PZ);
  // Both anchors sit on B's origin: the A-side anchor becomes an A-local
  // offset pointing at it, which is exactly the offset to hold.
  return jointCreate(JOINT_FIXED, bodyA, bodyB, bx, by, bz, bx, by, bz, 0.0, 0.0, 0.0);
}

/**
 * Swing B around a pivot, in the plane whose normal is `axis`.
 * The arm length is B's current in-plane distance from the pivot.
 */
export function jointCreateHinge(
  bodyA: i32,
  bodyB: i32,
  pivotX: f32,
  pivotY: f32,
  pivotZ: f32,
  axisX: f32,
  axisY: f32,
  axisZ: f32
): i32 {
  if (!bodyRefValid(bodyB) || bodyB < 0) return -1;
  return jointCreate(
    JOINT_HINGE, bodyA, bodyB,
    pivotX, pivotY, pivotZ,
    bget(bodyB, RB_F_PX), bget(bodyB, RB_F_PY), bget(bodyB, RB_F_PZ),
    axisX, axisY, axisZ
  );
}

/**
 * Damped distance spring between the two body origins.
 * @param rest negative => bind at the current separation
 */
export function jointCreateSpring(
  bodyA: i32,
  bodyB: i32,
  rest: f32,
  stiffness: f32,
  damping: f32
): i32 {
  if (!bodyRefValid(bodyA) || !bodyRefValid(bodyB)) return -1;
  const axw = bodyA >= 0 ? bget(bodyA, RB_F_PX) : bget(bodyB, RB_F_PX);
  const ayw = bodyA >= 0 ? bget(bodyA, RB_F_PY) : bget(bodyB, RB_F_PY);
  const azw = bodyA >= 0 ? bget(bodyA, RB_F_PZ) : bget(bodyB, RB_F_PZ);
  const bxw = bodyB >= 0 ? bget(bodyB, RB_F_PX) : axw;
  const byw = bodyB >= 0 ? bget(bodyB, RB_F_PY) : ayw;
  const bzw = bodyB >= 0 ? bget(bodyB, RB_F_PZ) : azw;
  return jointCreate(
    JOINT_SPRING, bodyA, bodyB, axw, ayw, azw, bxw, byw, bzw,
    rest, stiffness, damping
  );
}

/** Free a joint slot. Safe to call on an already-free id. */
export function jointDestroy(id: i32): void {
  if (!jointUsable(id)) return;
  const p = jpool();
  const j = jbase(id);
  for (let i = 0; i < FLOATS_PER_JOINT; i++) unchecked(p[j + i] = 0.0);
  _liveCount--;
  if (id == _highWater - 1) {
    let hw = _highWater;
    while (hw > 0 && (i32(unchecked(p[jbase(hw - 1) + J_FLAGS])) & JFLAG_ACTIVE) == 0) hw--;
    _highWater = hw;
  }
}

/** Destroy every joint (keeps the allocation). */
export function jointsClear(): void {
  if (_joints === null) return;
  const p = jpool();
  for (let i = 0; i < MAX_JOINTS * FLOATS_PER_JOINT; i++) unchecked(p[i] = 0.0);
  _highWater = 0;
  _liveCount = 0;
}

/**
 * Drop every joint that referenced a body. Called by rbDespawn() so a joint can
 * never outlive its endpoint and start pulling on a recycled slot.
 */
export function jointsOnBodyRemoved(bodyId: i32): void {
  if (_joints === null || bodyId < 0) return;
  const p = jpool();
  for (let id = 0; id < _highWater; id++) {
    const j = jbase(id);
    if ((i32(unchecked(p[j + J_FLAGS])) & JFLAG_ACTIVE) == 0) continue;
    if (i32(unchecked(p[j + J_BODY_A])) == bodyId || i32(unchecked(p[j + J_BODY_B])) == bodyId) {
      jointDestroy(id);
    }
  }
}

/** Softness for fixed/hinge projection: 0 = rigid, 0.95 = very loose. */
export function jointSetSoftness(id: i32, softness: f32): void {
  if (!jointUsable(id)) return;
  unchecked(jpool()[jbase(id) + J_SOFTNESS] = clampf(softness, 0.0, 0.95));
}

/**
 * Current constraint violation in world units — 0 when perfectly satisfied.
 * Fixed/hinge: distance from the target point. Spring: |length - rest|.
 * Exposed for tests and the debug overlay.
 */
export function jointGetError(id: i32): f32 {
  if (!jointUsable(id)) return 0.0;
  const p = jpool();
  const j = jbase(id);
  const a = i32(unchecked(p[j + J_BODY_A]));
  const b = i32(unchecked(p[j + J_BODY_B]));
  if (!bodyRefValid(a) || !bodyRefValid(b)) return 0.0;

  const wax = worldAnchorX(p, j, a, J_AX, RB_F_PX);
  const way = worldAnchorX(p, j, a, J_AY, RB_F_PY);
  const waz = worldAnchorX(p, j, a, J_AZ, RB_F_PZ);
  const wbx = worldAnchorX(p, j, b, J_BX, RB_F_PX);
  const wby = worldAnchorX(p, j, b, J_BY, RB_F_PY);
  const wbz = worldAnchorX(p, j, b, J_BZ, RB_F_PZ);

  const dx = wbx - wax, dy = wby - way, dz = wbz - waz;
  const type = i32(unchecked(p[j + J_TYPE]));

  if (type == JOINT_SPRING) {
    return Mathf.abs(Mathf.sqrt(dx * dx + dy * dy + dz * dz) - unchecked(p[j + J_P0]));
  }
  if (type == JOINT_HINGE) {
    const nx = unchecked(p[j + J_P0]), ny = unchecked(p[j + J_P1]), nz = unchecked(p[j + J_P2]);
    const axial = dx * nx + dy * ny + dz * nz;
    const rx = dx - axial * nx, ry = dy - axial * ny, rz = dz - axial * nz;
    const radial = Mathf.sqrt(rx * rx + ry * ry + rz * rz) - unchecked(p[j + J_P3]);
    return Mathf.sqrt(axial * axial + radial * radial);
  }
  return Mathf.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Resolve one anchor component to world space. */
// @ts-ignore
@inline
function worldAnchorX(p: StaticArray<f32>, j: i32, body: i32, jField: i32, bField: i32): f32 {
  const local = unchecked(p[j + jField]);
  return body >= 0 ? local + bget(body, bField) : local;
}

// -----------------------------------------------------------------------------
// Solver
// -----------------------------------------------------------------------------

/**
 * Advance every joint by one substep. Called from rigidbody.ts's substep()
 * after integration and environment contacts, before body-body contacts — so a
 * constraint wins over gravity for the frame, and a contact still gets the last
 * word on penetration.
 *
 * @param h substep length in seconds (> 0)
 */
export function solveJoints(h: f32): void {
  if (_joints === null || _liveCount == 0 || _bodyPtr == 0 || h <= 0.0) return;

  const p = jpool();
  const deltas = _deltas as StaticArray<f32>;
  const touched = _touched as StaticArray<i32>;

  for (let i = 0; i < MAX_DYNAMIC_BODIES; i++) {
    unchecked(touched[i] = 0);
    unchecked(deltas[i * 3] = 0.0);
    unchecked(deltas[i * 3 + 1] = 0.0);
    unchecked(deltas[i * 3 + 2] = 0.0);
  }

  // --- 1. Springs (soft, velocity level) ------------------------------------
  for (let id = 0; id < _highWater; id++) {
    const j = jbase(id);
    if ((i32(unchecked(p[j + J_FLAGS])) & JFLAG_ACTIVE) == 0) continue;
    if (i32(unchecked(p[j + J_TYPE])) != JOINT_SPRING) continue;
    if (!ensureEndpointsAlive(p, id, j)) continue;
    solveSpring(p, j, h);
  }

  // --- 2. Rigid constraints (positional, iterated) --------------------------
  for (let iter = 0; iter < JOINT_ITERATIONS; iter++) {
    for (let id = 0; id < _highWater; id++) {
      const j = jbase(id);
      if ((i32(unchecked(p[j + J_FLAGS])) & JFLAG_ACTIVE) == 0) continue;
      const type = i32(unchecked(p[j + J_TYPE]));
      if (type == JOINT_SPRING) continue;
      // Endpoint liveness was validated in pass 1 only for springs; do it here
      // for the rigid types too, on the first iteration.
      if (iter == 0 && !ensureEndpointsAlive(p, id, j)) continue;
      if ((i32(unchecked(p[j + J_FLAGS])) & JFLAG_ACTIVE) == 0) continue;
      projectRigid(p, j, type, deltas, touched);
    }
  }

  // --- 3. PBD velocity update ------------------------------------------------
  // v += dp / h. Exactly the velocity implied by the corrected position, given
  // the caller integrated p = p0 + v*h immediately before this pass.
  const invH: f32 = 1.0 / h;
  for (let id = 0; id < MAX_DYNAMIC_BODIES; id++) {
    if (unchecked(touched[id]) == 0) continue;
    const dx = unchecked(deltas[id * 3]);
    const dy = unchecked(deltas[id * 3 + 1]);
    const dz = unchecked(deltas[id * 3 + 2]);

    setVelocityClamped(
      id,
      bget(id, RB_F_VX) + dx * invH,
      bget(id, RB_F_VY) + dy * invH,
      bget(id, RB_F_VZ) + dz * invH
    );

    // A constrained body is doing work, so it must not be counted as settled.
    const flags = i32(bget(id, RB_F_FLAGS));
    if ((flags & RB_FLAG_SLEEPING) != 0) {
      bset(id, RB_F_FLAGS, f32(flags & ~RB_FLAG_SLEEPING));
    }
    bset(id, RB_F_SLEEP, 0.0);
  }
}

/**
 * Deactivate a joint whose endpoint has gone away (a despawn that bypassed
 * jointsOnBodyRemoved, or a slot recycled into a kinematic body).
 * @returns true when the joint is still solvable
 */
function ensureEndpointsAlive(p: StaticArray<f32>, id: i32, j: i32): bool {
  const a = i32(unchecked(p[j + J_BODY_A]));
  const b = i32(unchecked(p[j + J_BODY_B]));
  if (!bodyRefValid(a) || !bodyRefValid(b)) {
    jointDestroy(id);
    return false;
  }
  return invMassOf(a) > 0.0 || invMassOf(b) > 0.0;
}

/**
 * Explicit damped spring, integrated over one substep.
 *
 * F = -k*(len - rest) - c*relVel, applied along the anchor axis. Both terms are
 * clamped so the discrete step stays contractive: the position term may never
 * overshoot equilibrium within a substep (k*h^2*invSum <= 1) and the damping
 * term may never reverse the relative velocity (c*h*invSum <= 1). That is why a
 * k above the documented range soft-limits instead of exploding.
 */
function solveSpring(p: StaticArray<f32>, j: i32, h: f32): void {
  const a = i32(unchecked(p[j + J_BODY_A]));
  const b = i32(unchecked(p[j + J_BODY_B]));
  const invA = invMassOf(a);
  const invB = invMassOf(b);
  const invSum = invA + invB;
  if (invSum <= 0.0) return;

  const wax = worldAnchorX(p, j, a, J_AX, RB_F_PX);
  const way = worldAnchorX(p, j, a, J_AY, RB_F_PY);
  const waz = worldAnchorX(p, j, a, J_AZ, RB_F_PZ);
  const wbx = worldAnchorX(p, j, b, J_BX, RB_F_PX);
  const wby = worldAnchorX(p, j, b, J_BY, RB_F_PY);
  const wbz = worldAnchorX(p, j, b, J_BZ, RB_F_PZ);

  let dx = wbx - wax, dy = wby - way, dz = wbz - waz;
  const dist = Mathf.sqrt(dx * dx + dy * dy + dz * dz);
  // Coincident anchors give no direction; there is nothing to push along.
  if (dist < 1e-4) return;
  const nx = dx / dist, ny = dy / dist, nz = dz / dist;

  const rest = unchecked(p[j + J_P0]);
  const k = unchecked(p[j + J_P1]);
  const c = unchecked(p[j + J_P2]);

  const vax = a >= 0 ? bget(a, RB_F_VX) : 0.0;
  const vay = a >= 0 ? bget(a, RB_F_VY) : 0.0;
  const vaz = a >= 0 ? bget(a, RB_F_VZ) : 0.0;
  const vbx = b >= 0 ? bget(b, RB_F_VX) : 0.0;
  const vby = b >= 0 ? bget(b, RB_F_VY) : 0.0;
  const vbz = b >= 0 ? bget(b, RB_F_VZ) : 0.0;
  const relN = (vbx - vax) * nx + (vby - vay) * ny + (vbz - vaz) * nz;

  // Effective coefficients, capped at the explicit-integration stability limit.
  const kMax: f32 = 1.0 / (h * h * invSum);
  const cMax: f32 = 1.0 / (h * invSum);
  const kEff = k < kMax ? k : kMax;
  const cEff = c < cMax ? c : cMax;

  // Impulse on B along +n; A takes the reaction.
  const impulse: f32 = (-kEff * (dist - rest) - cEff * relN) * h;
  if (!isFinitef(impulse)) return;

  // Springs run *after* the integrator's own speed clamp, so they have to
  // re-apply one: a stiff spring released from a long stretch legitimately
  // stores enough energy to launch a body faster than a substep can resolve,
  // which is how a body tunnels through the terrain.
  if (invA > 0.0) {
    setVelocityClamped(
      a,
      vax - nx * impulse * invA,
      vay - ny * impulse * invA,
      vaz - nz * impulse * invA
    );
    wakeBody(a);
  }
  if (invB > 0.0) {
    setVelocityClamped(
      b,
      vbx + nx * impulse * invB,
      vby + ny * impulse * invB,
      vbz + nz * impulse * invB
    );
    wakeBody(b);
  }
}

/** Write a velocity, capped at MAX_JOINT_SPEED and sanitised. */
// @ts-ignore
@inline
function setVelocityClamped(id: i32, vx: f32, vy: f32, vz: f32): void {
  let x = vx, y = vy, z = vz;
  if (!isFinitef(x) || !isFinitef(y) || !isFinitef(z)) {
    x = 0.0; y = 0.0; z = 0.0;
  } else {
    const spSq = x * x + y * y + z * z;
    if (spSq > MAX_JOINT_SPEED * MAX_JOINT_SPEED) {
      const s = MAX_JOINT_SPEED / Mathf.sqrt(spSq);
      x *= s; y *= s; z *= s;
    }
  }
  bset(id, RB_F_VX, x);
  bset(id, RB_F_VY, y);
  bset(id, RB_F_VZ, z);
}

/**
 * One projection pass for a fixed or hinge joint.
 *
 * Both reduce to "move anchor B to a target point relative to anchor A":
 *   fixed — the target is anchor A itself (zero separation)
 *   hinge — the target is the point on the hinge circle nearest to B: project
 *           the separation onto the plane through the pivot with normal `axis`,
 *           then rescale it to the arm length
 * The correction is split by inverse mass and accumulated so the velocity pass
 * can turn it into motion.
 */
function projectRigid(
  p: StaticArray<f32>,
  j: i32,
  type: i32,
  deltas: StaticArray<f32>,
  touched: StaticArray<i32>
): void {
  const a = i32(unchecked(p[j + J_BODY_A]));
  const b = i32(unchecked(p[j + J_BODY_B]));
  const invA = invMassOf(a);
  const invB = invMassOf(b);
  const invSum = invA + invB;
  if (invSum <= 0.0) return;

  const wax = worldAnchorX(p, j, a, J_AX, RB_F_PX);
  const way = worldAnchorX(p, j, a, J_AY, RB_F_PY);
  const waz = worldAnchorX(p, j, a, J_AZ, RB_F_PZ);
  const wbx = worldAnchorX(p, j, b, J_BX, RB_F_PX);
  const wby = worldAnchorX(p, j, b, J_BY, RB_F_PY);
  const wbz = worldAnchorX(p, j, b, J_BZ, RB_F_PZ);

  const dx = wbx - wax, dy = wby - way, dz = wbz - waz;

  // Target separation.
  let tx: f32 = 0.0, ty: f32 = 0.0, tz: f32 = 0.0;
  if (type == JOINT_HINGE) {
    const nx = unchecked(p[j + J_P0]);
    const ny = unchecked(p[j + J_P1]);
    const nz = unchecked(p[j + J_P2]);
    const arm = unchecked(p[j + J_P3]);

    const axial = dx * nx + dy * ny + dz * nz;
    let rx = dx - axial * nx;
    let ry = dy - axial * ny;
    let rz = dz - axial * nz;
    const rl = Mathf.sqrt(rx * rx + ry * ry + rz * rz);
    if (rl > 1e-5) {
      const s = arm / rl;
      tx = rx * s; ty = ry * s; tz = rz * s;
    } else if (arm > 1e-5) {
      // Body sits exactly on the axis: no in-plane direction is defined. Pick
      // any vector orthogonal to the axis so it leaves the singularity instead
      // of dividing by ~0.
      let ox: f32 = 0.0, oy: f32 = 1.0, oz: f32 = 0.0;
      if (Mathf.abs(ny) > 0.9) { ox = 1.0; oy = 0.0; oz = 0.0; }
      const d = ox * nx + oy * ny + oz * nz;
      ox -= d * nx; oy -= d * ny; oz -= d * nz;
      const ol = Mathf.sqrt(ox * ox + oy * oy + oz * oz);
      if (ol > 1e-5) {
        tx = ox / ol * arm; ty = oy / ol * arm; tz = oz / ol * arm;
      }
    }
  }
  // JOINT_FIXED leaves the target at (0,0,0): anchors must coincide.

  let cx = tx - dx;
  let cy = ty - dy;
  let cz = tz - dz;

  const soft: f32 = 1.0 - unchecked(p[j + J_SOFTNESS]);
  cx *= soft; cy *= soft; cz *= soft;

  const mag = Mathf.sqrt(cx * cx + cy * cy + cz * cz);
  if (!isFinitef(mag) || mag <= SETTLE_EPS) return;
  if (mag > MAX_CORRECTION) {
    const s = MAX_CORRECTION / mag;
    cx *= s; cy *= s; cz *= s;
  }

  // Split by inverse mass: the heavier end moves less, the world not at all.
  if (invB > 0.0) {
    const w = invB / invSum;
    applyCorrection(b, cx * w, cy * w, cz * w, deltas, touched);
  }
  if (invA > 0.0) {
    const w = invA / invSum;
    applyCorrection(a, -cx * w, -cy * w, -cz * w, deltas, touched);
  }
}

// @ts-ignore
@inline
function applyCorrection(
  id: i32,
  dx: f32,
  dy: f32,
  dz: f32,
  deltas: StaticArray<f32>,
  touched: StaticArray<i32>
): void {
  bset(id, RB_F_PX, bget(id, RB_F_PX) + dx);
  bset(id, RB_F_PY, bget(id, RB_F_PY) + dy);
  bset(id, RB_F_PZ, bget(id, RB_F_PZ) + dz);
  unchecked(deltas[id * 3] += dx);
  unchecked(deltas[id * 3 + 1] += dy);
  unchecked(deltas[id * 3 + 2] += dz);
  unchecked(touched[id] = 1);
}

// @ts-ignore
@inline
function wakeBody(id: i32): void {
  const flags = i32(bget(id, RB_F_FLAGS));
  if ((flags & RB_FLAG_SLEEPING) != 0) {
    bset(id, RB_F_FLAGS, f32(flags & ~RB_FLAG_SLEEPING));
  }
  bset(id, RB_F_SLEEP, 0.0);
}
