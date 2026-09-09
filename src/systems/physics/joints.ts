/**
 * @file joints.ts
 * @brief TS bridge for the joint layer — fixed, hinge and spring constraints.
 *
 * Sits on top of the dynamic rigid-body layer (`rigid-bodies.ts`) the same way
 * that sits on the WASM solver: it prefers the AssemblyScript implementation
 * (`assembly/joints.ts`) and transparently falls back to `joint-fallback.ts`,
 * with an identical pool layout on both paths so callers and the debug overlay
 * never branch on which one is live.
 *
 * What a joint *is* here: the body layer carries no angular state, so a
 * constraint relates two **points**, not two frames.
 *
 *   fixed  — B keeps its bind-time offset from A (a weld)
 *   hinge  — B swings on a fixed-length arm around a pivot, confined to the
 *            plane through that pivot whose normal is the hinge axis. One
 *            rotational degree of freedom: a swing, a trap lid, a pendulum.
 *            A zero-length arm degenerates to a pin.
 *   spring — a damped distance constraint between the two body origins
 *
 * Either end may be `null`, meaning "anchored to the immovable world"; a
 * kinematic body works as an anchor too and additionally lets gameplay move the
 * mounting point. A joint between two immovable ends is rejected — there would
 * be nothing to solve.
 *
 * Scope: enough for interactive candy toys. Explicit non-goals are generic D6
 * joints, ragdolls, cloth, and motorised articulated skeletons.
 */

import {
    getRigidBodyExports,
    getRigidBodyPool,
    initRigidBodies,
    setFallbackJointHooks,
    type FallbackJointHooks,
} from './rigid-bodies.ts';
import type { RigidBodyHandle } from './rigid-body-types.ts';
import { MAX_DYNAMIC_BODIES, RB_FIELD as F, RB_FLOATS_PER_BODY } from './rigid-body-types.ts';
import { createJointPool, solveJointsJS, writeJointRecord } from './joint-fallback.ts';
import {
    J_FIELD as J,
    J_FLAG,
    J_FLOATS_PER_JOINT,
    JOINT_TYPE,
    MAX_JOINTS,
    SPRING_RANGE,
    type JointEnd,
    type JointHandle,
    type JointType,
    type Vec3Like,
} from './joint-types.ts';

export {
    MAX_JOINTS,
    JOINT_TYPE,
    J_FIELD,
    J_FLAG,
    J_FLOATS_PER_JOINT,
    SPRING_RANGE,
} from './joint-types.ts';
export type { JointEnd, JointHandle, JointType, Vec3Like } from './joint-types.ts';

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

let _initialized = false;
let _useWasm = false;

/** Byte pointer to the WASM pool; re-used to rebuild the view after a grow. */
let _poolPtr = 0;
let _pool: Float32Array | null = null;
let _poolBuffer: ArrayBufferLike | null = null;

/** Fallback-path bookkeeping (WASM owns these on the fast path). */
let _fallbackHighWater = 0;
let _fallbackCount = 0;

/** Exclusive upper bound of occupied slots, for the debug overlay. */
let _highWaterHint = 0;

const _hooks: FallbackJointHooks = {
    solve: (h) => {
        const joints = _pool;
        const bodies = getRigidBodyPool();
        if (!joints || !bodies) return;
        solveJointsJS(joints, bodies, _fallbackHighWater, h, releaseFallbackSlot);
    },
    onBodyRemoved: (id) => {
        const joints = _pool;
        if (!joints || id < 0) return;
        for (let j = 0; j < _fallbackHighWater; j++) {
            const base = j * J_FLOATS_PER_JOINT;
            if (!(joints[base + J.FLAGS] & J_FLAG.ACTIVE)) continue;
            if (joints[base + J.BODY_A] === id || joints[base + J.BODY_B] === id) {
                destroyJoint({ id: j, type: joints[base + J.TYPE] as JointType });
            }
        }
    },
    onClear: () => clearJoints(),
};

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------

/**
 * Initialize the joint layer. Idempotent; safe to call before or after WASM is
 * ready (a later call upgrades a fallback pool to the WASM one).
 *
 * Initializing the rigid-body layer first is required and done here — a joint
 * without bodies has nothing to constrain.
 *
 * @returns true when the AssemblyScript solver is driving the constraints
 */
export function initJoints(): boolean {
    if (_initialized && _useWasm) return true;

    const bodyWasm = initRigidBodies();
    const exports = getRigidBodyExports();

    if (bodyWasm && exports && typeof exports.jointCount === 'function') {
        // assembly/rigidbody.ts calls initJointSystem() from
        // initRigidBodySystem(), so the pool is already allocated and bound to
        // the body pool by the time we get here; jointPoolPointer() just hands
        // back its address for the zero-copy view.
        _poolPtr = exports.jointPoolPointer?.() ?? 0;
        _useWasm = _poolPtr > 0;
    }

    if (_useWasm) {
        setFallbackJointHooks(null);
    } else {
        _pool = createJointPool();
        _poolBuffer = _pool.buffer;
        setFallbackJointHooks(_hooks);
        console.warn('[Joints] WASM solver unavailable — using JS fallback');
    }

    _fallbackHighWater = 0;
    _fallbackCount = 0;
    _highWaterHint = 0;
    _initialized = true;
    return _useWasm;
}

export function isJointWasmActive(): boolean {
    return _useWasm;
}

/**
 * The shared joint pool view, or `null` when the layer is not initialized.
 * Rebuilt only when WASM linear memory grows and detaches the old ArrayBuffer.
 */
export function getJointPool(): Float32Array | null {
    if (!_useWasm) return _pool;

    const bodyPool = getRigidBodyPool();
    const buffer = bodyPool?.buffer ?? null;
    if (!buffer) return null;
    if (_pool && _poolBuffer === buffer) return _pool;

    _poolBuffer = buffer;
    _pool = new Float32Array(buffer, _poolPtr, MAX_JOINTS * J_FLOATS_PER_JOINT);
    return _pool;
}

/** Exclusive upper bound of occupied joint slots — for iteration in overlays. */
export function getJointHighWater(): number {
    if (!_useWasm) return _fallbackHighWater;
    // AS shrinks its own bound past trailing free slots, including joints the
    // solver dropped lazily; _highWaterHint is only the pre-export fallback.
    return getRigidBodyExports()?.jointHighWater?.() ?? _highWaterHint;
}

export function getJointCount(): number {
    if (_useWasm) return getRigidBodyExports()?.jointCount?.() ?? 0;
    return _fallbackCount;
}

// -----------------------------------------------------------------------------
// Creation
// -----------------------------------------------------------------------------

/** `-1` is the world anchor; anything else is a pool slot. */
function endId(end: JointEnd): number {
    return end ? end.id : -1;
}

/** World position of a body origin, or `null` when the body is not live. */
function bodyOrigin(id: number, out: [number, number, number]): boolean {
    if (id < 0) return false;
    const pool = getRigidBodyPool();
    if (!pool || id >= MAX_DYNAMIC_BODIES) return false;
    const b = id * RB_FLOATS_PER_BODY;
    out[0] = pool[b + F.PX];
    out[1] = pool[b + F.PY];
    out[2] = pool[b + F.PZ];
    return true;
}

const _scratchA: [number, number, number] = [0, 0, 0];
const _scratchB: [number, number, number] = [0, 0, 0];

/**
 * Shared create path. Anchors are **world space**; the solver stores them
 * relative to their body, so the joint holds whatever configuration existed at
 * bind time.
 *
 * @returns a handle, or `null` when the layer is off, the pool is full, the
 *          bodies are invalid, or both ends are immovable
 */
function create(
    type: JointType,
    a: JointEnd,
    b: JointEnd,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    p0: number,
    p1: number,
    p2: number
): JointHandle | null {
    if (!_initialized) initJoints();

    const idA = endId(a);
    const idB = endId(b);

    let id: number;
    if (_useWasm) {
        const exports = getRigidBodyExports();
        if (!exports?.jointCreate) return null;
        id = exports.jointCreate(type, idA, idB, ax, ay, az, bx, by, bz, p0, p1, p2);
    } else {
        id = createFallback(type, idA, idB, ax, ay, az, bx, by, bz, p0, p1, p2);
    }

    if (id < 0) {
        console.warn(
            `[Joints] create rejected (type ${type}, bodies ${idA}/${idB}) — ` +
                `pool full (${MAX_JOINTS}), dead body, or two immovable ends`
        );
        return null;
    }

    if (id >= _highWaterHint) _highWaterHint = id + 1;
    return { id, type };
}

function createFallback(
    type: JointType,
    idA: number,
    idB: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    p0: number,
    p1: number,
    p2: number
): number {
    const joints = _pool;
    const bodies = getRigidBodyPool();
    if (!joints || !bodies) return -1;

    let id = -1;
    for (let i = 0; i < MAX_JOINTS; i++) {
        if (!(joints[i * J_FLOATS_PER_JOINT + J.FLAGS] & J_FLAG.ACTIVE)) {
            id = i;
            break;
        }
    }
    if (id < 0) return -1;

    const ok = writeJointRecord(
        joints,
        bodies,
        id,
        type,
        idA,
        idB,
        ax,
        ay,
        az,
        bx,
        by,
        bz,
        p0,
        p1,
        p2
    );
    if (!ok) return -1;

    if (id >= _fallbackHighWater) _fallbackHighWater = id + 1;
    _fallbackCount++;
    return id;
}

/**
 * Weld two bodies together, preserving their current relative offset.
 *
 * @param a anchor body, or `null` for the world
 * @param b the welded body — required, and must be movable if `a` is not
 */
export function createFixed(a: JointEnd, b: RigidBodyHandle): JointHandle | null {
    if (!b) return null;
    if (!_initialized) initJoints();
    if (!bodyOrigin(b.id, _scratchB)) return null;
    const [bx, by, bz] = _scratchB;
    // Both anchors sit on B's origin: the A-side anchor becomes an A-local
    // offset pointing at it, which is exactly the offset to hold.
    return create(JOINT_TYPE.FIXED, a, b, bx, by, bz, bx, by, bz, 0, 0, 0);
}

/**
 * Swing `b` around `pivot`, in the plane whose normal is `axis`. The arm length
 * is `b`'s current in-plane distance from the pivot, so place the body where it
 * should hang before creating the hinge.
 *
 * @param a     the body carrying the pivot (a kinematic beam, say), or `null`
 *              to pin the pivot to the world
 * @param b     the swinging body
 * @param pivot world-space pivot point
 * @param axis  rotation axis; need not be normalised. A degenerate axis falls
 *              back to world up.
 */
export function createHinge(
    a: JointEnd,
    b: RigidBodyHandle,
    pivot: Vec3Like,
    axis: Vec3Like
): JointHandle | null {
    if (!b) return null;
    if (!_initialized) initJoints();
    if (!bodyOrigin(b.id, _scratchB)) return null;
    const [bx, by, bz] = _scratchB;
    return create(
        JOINT_TYPE.HINGE,
        a,
        b,
        pivot.x,
        pivot.y,
        pivot.z,
        bx,
        by,
        bz,
        axis.x,
        axis.y,
        axis.z
    );
}

/**
 * Damped distance spring between the two body origins.
 *
 * @param rest rest length in world units; pass a negative value to bind at the
 *             current separation
 * @param k    stiffness. See SPRING_RANGE — outside it the solver soft-limits
 *             rather than diverging, but below ~10 a body just sags a long way
 *             (gravity is 22 u/s²) and above 4000 the response saturates.
 * @param damp damping, 0 (bouncy forever) .. 400
 */
export function createSpring(
    a: JointEnd,
    b: JointEnd,
    rest: number,
    k: number,
    damp: number
): JointHandle | null {
    if (!_initialized) initJoints();

    const idA = endId(a);
    const idB = endId(b);
    const haveA = bodyOrigin(idA, _scratchA);
    const haveB = bodyOrigin(idB, _scratchB);
    if (!haveA && !haveB) return null;

    // A world-anchored end takes the *other* end's current position, so a
    // spring created against the world starts from where the body already is.
    const [ax, ay, az] = haveA ? _scratchA : _scratchB;
    const [bx, by, bz] = haveB ? _scratchB : _scratchA;

    return create(JOINT_TYPE.SPRING, a, b, ax, ay, az, bx, by, bz, rest, k, damp);
}

// -----------------------------------------------------------------------------
// Mutation / teardown
// -----------------------------------------------------------------------------

/** Softness for fixed/hinge projection: 0 = rigid (default), 0.95 = very loose. */
export function setJointSoftness(handle: JointHandle | null, softness: number): void {
    if (!handle) return;
    const clamped = Math.min(Math.max(softness, 0), 0.95);
    if (_useWasm) {
        getRigidBodyExports()?.jointSetSoftness?.(handle.id, clamped);
        return;
    }
    const joints = _pool;
    if (!joints) return;
    const j = handle.id * J_FLOATS_PER_JOINT;
    if (!(joints[j + J.FLAGS] & J_FLAG.ACTIVE)) return;
    joints[j + J.SOFTNESS] = clamped;
}

/**
 * Current constraint violation in world units — 0 when perfectly satisfied.
 * Fixed/hinge: distance from the target point. Spring: |length - rest|.
 */
export function getJointError(handle: JointHandle | null): number {
    if (!handle) return 0;
    if (_useWasm) return getRigidBodyExports()?.jointGetError?.(handle.id) ?? 0;

    const joints = _pool;
    const bodies = getRigidBodyPool();
    if (!joints || !bodies) return 0;
    const j = handle.id * J_FLOATS_PER_JOINT;
    if (!(joints[j + J.FLAGS] & J_FLAG.ACTIVE)) return 0;

    const a = joints[j + J.BODY_A];
    const b = joints[j + J.BODY_B];
    const [wax, way, waz] = jointAnchorWorld(joints, bodies, j, a, J.AX);
    const [wbx, wby, wbz] = jointAnchorWorld(joints, bodies, j, b, J.BX);
    const dx = wbx - wax;
    const dy = wby - way;
    const dz = wbz - waz;

    switch (joints[j + J.TYPE]) {
        case JOINT_TYPE.SPRING:
            return Math.abs(Math.sqrt(dx * dx + dy * dy + dz * dz) - joints[j + J.P0]);
        case JOINT_TYPE.HINGE: {
            const nx = joints[j + J.P0];
            const ny = joints[j + J.P1];
            const nz = joints[j + J.P2];
            const axial = dx * nx + dy * ny + dz * nz;
            const rx = dx - axial * nx;
            const ry = dy - axial * ny;
            const rz = dz - axial * nz;
            const radial = Math.sqrt(rx * rx + ry * ry + rz * rz) - joints[j + J.P3];
            return Math.sqrt(axial * axial + radial * radial);
        }
        default:
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}

/**
 * Resolve one joint anchor to world space. Shared with the debug overlay, which
 * draws the constraint as a line between the two anchors.
 *
 * @param anchorField J_FIELD.AX or J_FIELD.BX — the first of the xyz triple
 */
export function jointAnchorWorld(
    joints: Float32Array,
    bodies: Float32Array,
    j: number,
    body: number,
    anchorField: number
): [number, number, number] {
    const lx = joints[j + anchorField];
    const ly = joints[j + anchorField + 1];
    const lz = joints[j + anchorField + 2];
    if (body < 0) return [lx, ly, lz];
    const b = body * RB_FLOATS_PER_BODY;
    return [lx + bodies[b + F.PX], ly + bodies[b + F.PY], lz + bodies[b + F.PZ]];
}

/** Remove a joint. The bodies it constrained are left alone. */
export function destroyJoint(handle: JointHandle | null): void {
    if (!handle || handle.id < 0 || handle.id >= MAX_JOINTS) return;

    if (_useWasm) {
        getRigidBodyExports()?.jointDestroy?.(handle.id);
        return;
    }
    releaseFallbackSlot(handle.id);
}

/** Free a fallback slot and shrink the iteration bound past trailing holes. */
function releaseFallbackSlot(id: number): void {
    const joints = _pool;
    if (!joints) return;
    const j = id * J_FLOATS_PER_JOINT;
    if (!(joints[j + J.FLAGS] & J_FLAG.ACTIVE)) return;
    for (let i = 0; i < J_FLOATS_PER_JOINT; i++) joints[j + i] = 0;
    _fallbackCount--;
    while (
        _fallbackHighWater > 0 &&
        !(joints[(_fallbackHighWater - 1) * J_FLOATS_PER_JOINT + J.FLAGS] & J_FLAG.ACTIVE)
    ) {
        _fallbackHighWater--;
    }
}

/** Destroy every joint. Called for you by `clearRigidBodies()`. */
export function clearJoints(): void {
    if (_useWasm) {
        getRigidBodyExports()?.jointsClear?.();
    } else if (_pool) {
        _pool.fill(0);
        _fallbackHighWater = 0;
        _fallbackCount = 0;
    }
    _highWaterHint = 0;
}
