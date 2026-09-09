/**
 * @file joint-fallback.ts
 * @brief Pure-JS mirror of assembly/joints.ts.
 *
 * Used when the AssemblyScript module is unavailable (WASM disabled, init
 * failure, or a non-WebAssembly test environment). It operates on the *same*
 * flat Float32Array layouts as the WASM pools, so the bridge above it and the
 * debug visualizer are identical on both paths.
 *
 * The algorithm is the one documented in assembly/joints.ts: springs are an
 * explicit damped force applied at the velocity level, fixed and hinge joints
 * are position-projected a fixed number of times and then converted back into
 * velocity with the PBD update `v += dp / h`.
 */

import { J_FIELD as J, J_FLAG, J_FLOATS_PER_JOINT, JOINT_TYPE, MAX_JOINTS } from './joint-types.ts';
import {
    MAX_DYNAMIC_BODIES,
    RB_FIELD as F,
    RB_FLAG,
    RB_FLOATS_PER_BODY,
} from './rigid-body-types.ts';

// Mirrors the tuning block in assembly/joints.ts.
const JOINT_ITERATIONS = 4;
const MAX_CORRECTION = 2.0;
const MAX_JOINT_SPEED = 60.0;
const SETTLE_EPS = 1e-5;

export const SPRING_MAX_STIFFNESS = 4000.0;
export const SPRING_MAX_DAMPING = 400.0;

/** Scratch, allocated once: the hot path must stay allocation-free. */
const _deltas = new Float32Array(MAX_DYNAMIC_BODIES * 3);
const _touched = new Uint8Array(MAX_DYNAMIC_BODIES);

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Inverse mass, or 0 for kinematic / world (-1) — i.e. "immovable". */
function invMassOf(bodies: Float32Array, id: number): number {
    if (id < 0) return 0;
    return bodies[id * RB_FLOATS_PER_BODY + F.INV_MASS];
}

/** True when the id names a live body, or the world (which is always valid). */
export function bodyRefValid(bodies: Float32Array, id: number): boolean {
    if (id < 0) return true;
    if (id >= MAX_DYNAMIC_BODIES) return false;
    return (bodies[id * RB_FLOATS_PER_BODY + F.FLAGS] & RB_FLAG.ACTIVE) !== 0;
}

/** Resolve one anchor component to world space. */
function worldAnchor(
    joints: Float32Array,
    j: number,
    body: number,
    jField: number,
    bField: number
): number {
    const local = joints[j + jField];
    return body >= 0 ? local + joints_bodyRead(body, bField) : local;
}

// `worldAnchor` needs the body pool but is called from several places; keeping a
// module-scoped reference for the duration of a solve avoids threading it (and
// an extra argument) through every call in the inner loop.
let _bodies: Float32Array | null = null;
function joints_bodyRead(id: number, field: number): number {
    return (_bodies as Float32Array)[id * RB_FLOATS_PER_BODY + field];
}

/** Write a velocity, capped at MAX_JOINT_SPEED and sanitised. */
function setVelocityClamped(
    bodies: Float32Array,
    id: number,
    vx: number,
    vy: number,
    vz: number
): void {
    let x = vx;
    let y = vy;
    let z = vz;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        x = 0;
        y = 0;
        z = 0;
    } else {
        const spSq = x * x + y * y + z * z;
        if (spSq > MAX_JOINT_SPEED * MAX_JOINT_SPEED) {
            const s = MAX_JOINT_SPEED / Math.sqrt(spSq);
            x *= s;
            y *= s;
            z *= s;
        }
    }
    const b = id * RB_FLOATS_PER_BODY;
    bodies[b + F.VX] = x;
    bodies[b + F.VY] = y;
    bodies[b + F.VZ] = z;
}

function wakeBody(bodies: Float32Array, id: number): void {
    const b = id * RB_FLOATS_PER_BODY;
    bodies[b + F.FLAGS] &= ~RB_FLAG.SLEEPING;
    bodies[b + F.SLEEP] = 0;
}

/**
 * Advance every joint by one substep, in place.
 *
 * @param joints    flat joint array, J_FLOATS_PER_JOINT per joint
 * @param bodies    flat body array, RB_FLOATS_PER_BODY per body
 * @param highWater exclusive upper bound of occupied joint slots
 * @param h         substep length in seconds (> 0)
 * @param onDangling called with the id of any joint whose endpoint has gone
 *                   away, so the bridge can free the slot
 */
export function solveJointsJS(
    joints: Float32Array,
    bodies: Float32Array,
    highWater: number,
    h: number,
    onDangling?: (id: number) => void
): void {
    if (highWater <= 0 || !(h > 0)) return;

    _bodies = bodies;
    _deltas.fill(0);
    _touched.fill(0);

    // --- 1. Springs (soft, velocity level) ---------------------------------
    for (let id = 0; id < highWater; id++) {
        const j = id * J_FLOATS_PER_JOINT;
        if (!(joints[j + J.FLAGS] & J_FLAG.ACTIVE)) continue;
        if (joints[j + J.TYPE] !== JOINT_TYPE.SPRING) continue;
        if (!endpointsAlive(joints, bodies, id, j, onDangling)) continue;
        solveSpring(joints, bodies, j, h);
    }

    // --- 2. Rigid constraints (positional, iterated) -----------------------
    for (let iter = 0; iter < JOINT_ITERATIONS; iter++) {
        for (let id = 0; id < highWater; id++) {
            const j = id * J_FLOATS_PER_JOINT;
            if (!(joints[j + J.FLAGS] & J_FLAG.ACTIVE)) continue;
            const type = joints[j + J.TYPE];
            if (type === JOINT_TYPE.SPRING) continue;
            if (iter === 0 && !endpointsAlive(joints, bodies, id, j, onDangling)) continue;
            if (!(joints[j + J.FLAGS] & J_FLAG.ACTIVE)) continue;
            projectRigid(joints, bodies, j, type);
        }
    }

    // --- 3. PBD velocity update --------------------------------------------
    const invH = 1 / h;
    for (let id = 0; id < MAX_DYNAMIC_BODIES; id++) {
        if (!_touched[id]) continue;
        const b = id * RB_FLOATS_PER_BODY;
        setVelocityClamped(
            bodies,
            id,
            bodies[b + F.VX] + _deltas[id * 3] * invH,
            bodies[b + F.VY] + _deltas[id * 3 + 1] * invH,
            bodies[b + F.VZ] + _deltas[id * 3 + 2] * invH
        );
        // A constrained body is doing work, so it must not be counted as settled.
        bodies[b + F.FLAGS] &= ~RB_FLAG.SLEEPING;
        bodies[b + F.SLEEP] = 0;
    }

    _bodies = null;
}

/**
 * Deactivate a joint whose endpoint has gone away.
 * @returns true when the joint is still solvable
 */
function endpointsAlive(
    joints: Float32Array,
    bodies: Float32Array,
    id: number,
    j: number,
    onDangling?: (id: number) => void
): boolean {
    const a = joints[j + J.BODY_A];
    const b = joints[j + J.BODY_B];
    if (!bodyRefValid(bodies, a) || !bodyRefValid(bodies, b)) {
        joints[j + J.FLAGS] = 0;
        onDangling?.(id);
        return false;
    }
    return invMassOf(bodies, a) > 0 || invMassOf(bodies, b) > 0;
}

/** Explicit damped spring — see the AS original for the stability argument. */
function solveSpring(joints: Float32Array, bodies: Float32Array, j: number, h: number): void {
    const a = joints[j + J.BODY_A];
    const b = joints[j + J.BODY_B];
    const invA = invMassOf(bodies, a);
    const invB = invMassOf(bodies, b);
    const invSum = invA + invB;
    if (invSum <= 0) return;

    const wax = worldAnchor(joints, j, a, J.AX, F.PX);
    const way = worldAnchor(joints, j, a, J.AY, F.PY);
    const waz = worldAnchor(joints, j, a, J.AZ, F.PZ);
    const wbx = worldAnchor(joints, j, b, J.BX, F.PX);
    const wby = worldAnchor(joints, j, b, J.BY, F.PY);
    const wbz = worldAnchor(joints, j, b, J.BZ, F.PZ);

    const dx = wbx - wax;
    const dy = wby - way;
    const dz = wbz - waz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Coincident anchors give no direction; there is nothing to push along.
    if (dist < 1e-4) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;

    const rest = joints[j + J.P0];
    const k = joints[j + J.P1];
    const c = joints[j + J.P2];

    const ba = a * RB_FLOATS_PER_BODY;
    const bb = b * RB_FLOATS_PER_BODY;
    const vax = a >= 0 ? bodies[ba + F.VX] : 0;
    const vay = a >= 0 ? bodies[ba + F.VY] : 0;
    const vaz = a >= 0 ? bodies[ba + F.VZ] : 0;
    const vbx = b >= 0 ? bodies[bb + F.VX] : 0;
    const vby = b >= 0 ? bodies[bb + F.VY] : 0;
    const vbz = b >= 0 ? bodies[bb + F.VZ] : 0;
    const relN = (vbx - vax) * nx + (vby - vay) * ny + (vbz - vaz) * nz;

    // Effective coefficients, capped at the explicit-integration stability limit.
    const kEff = Math.min(k, 1 / (h * h * invSum));
    const cEff = Math.min(c, 1 / (h * invSum));

    const impulse = (-kEff * (dist - rest) - cEff * relN) * h;
    if (!Number.isFinite(impulse)) return;

    if (invA > 0) {
        setVelocityClamped(
            bodies,
            a,
            vax - nx * impulse * invA,
            vay - ny * impulse * invA,
            vaz - nz * impulse * invA
        );
        wakeBody(bodies, a);
    }
    if (invB > 0) {
        setVelocityClamped(
            bodies,
            b,
            vbx + nx * impulse * invB,
            vby + ny * impulse * invB,
            vbz + nz * impulse * invB
        );
        wakeBody(bodies, b);
    }
}

/** One projection pass for a fixed or hinge joint. */
function projectRigid(joints: Float32Array, bodies: Float32Array, j: number, type: number): void {
    const a = joints[j + J.BODY_A];
    const b = joints[j + J.BODY_B];
    const invA = invMassOf(bodies, a);
    const invB = invMassOf(bodies, b);
    const invSum = invA + invB;
    if (invSum <= 0) return;

    const wax = worldAnchor(joints, j, a, J.AX, F.PX);
    const way = worldAnchor(joints, j, a, J.AY, F.PY);
    const waz = worldAnchor(joints, j, a, J.AZ, F.PZ);
    const wbx = worldAnchor(joints, j, b, J.BX, F.PX);
    const wby = worldAnchor(joints, j, b, J.BY, F.PY);
    const wbz = worldAnchor(joints, j, b, J.BZ, F.PZ);

    const dx = wbx - wax;
    const dy = wby - way;
    const dz = wbz - waz;

    // Target separation. JOINT_FIXED leaves it at the origin: anchors coincide.
    let tx = 0;
    let ty = 0;
    let tz = 0;
    if (type === JOINT_TYPE.HINGE) {
        const nx = joints[j + J.P0];
        const ny = joints[j + J.P1];
        const nz = joints[j + J.P2];
        const arm = joints[j + J.P3];

        const axial = dx * nx + dy * ny + dz * nz;
        const rx = dx - axial * nx;
        const ry = dy - axial * ny;
        const rz = dz - axial * nz;
        const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (rl > 1e-5) {
            const s = arm / rl;
            tx = rx * s;
            ty = ry * s;
            tz = rz * s;
        } else if (arm > 1e-5) {
            // Body sits exactly on the axis: no in-plane direction is defined.
            // Pick any vector orthogonal to the axis so it leaves the singularity.
            let ox = 0;
            let oy = 1;
            let oz = 0;
            if (Math.abs(ny) > 0.9) {
                ox = 1;
                oy = 0;
                oz = 0;
            }
            const d = ox * nx + oy * ny + oz * nz;
            ox -= d * nx;
            oy -= d * ny;
            oz -= d * nz;
            const ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
            if (ol > 1e-5) {
                tx = (ox / ol) * arm;
                ty = (oy / ol) * arm;
                tz = (oz / ol) * arm;
            }
        }
    }

    const soft = 1 - joints[j + J.SOFTNESS];
    let cx = (tx - dx) * soft;
    let cy = (ty - dy) * soft;
    let cz = (tz - dz) * soft;

    const mag = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (!Number.isFinite(mag) || mag <= SETTLE_EPS) return;
    if (mag > MAX_CORRECTION) {
        const s = MAX_CORRECTION / mag;
        cx *= s;
        cy *= s;
        cz *= s;
    }

    // Split by inverse mass: the heavier end moves less, the world not at all.
    if (invB > 0) {
        const w = invB / invSum;
        applyCorrection(bodies, b, cx * w, cy * w, cz * w);
    }
    if (invA > 0) {
        const w = invA / invSum;
        applyCorrection(bodies, a, -cx * w, -cy * w, -cz * w);
    }
}

function applyCorrection(
    bodies: Float32Array,
    id: number,
    dx: number,
    dy: number,
    dz: number
): void {
    const b = id * RB_FLOATS_PER_BODY;
    bodies[b + F.PX] += dx;
    bodies[b + F.PY] += dy;
    bodies[b + F.PZ] += dz;
    _deltas[id * 3] += dx;
    _deltas[id * 3 + 1] += dy;
    _deltas[id * 3 + 2] += dz;
    _touched[id] = 1;
}

/**
 * Fill a joint record from world-space anchors. Shared by the WASM-less create
 * path in `joints.ts`; mirrors jointCreate() in assembly/joints.ts.
 *
 * @returns false when the joint is not solvable and the slot should stay free
 */
export function writeJointRecord(
    joints: Float32Array,
    bodies: Float32Array,
    id: number,
    type: number,
    bodyA: number,
    bodyB: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    p0: number,
    p1: number,
    p2: number
): boolean {
    if (type < JOINT_TYPE.FIXED || type > JOINT_TYPE.SPRING) return false;
    if (!bodyRefValid(bodies, bodyA) || !bodyRefValid(bodies, bodyB)) return false;
    if (bodyA < 0 && bodyB < 0) return false;
    if (invMassOf(bodies, bodyA) <= 0 && invMassOf(bodies, bodyB) <= 0) return false;
    for (const v of [ax, ay, az, bx, by, bz]) if (!Number.isFinite(v)) return false;

    const j = id * J_FLOATS_PER_JOINT;

    // World anchors -> body-local offsets (identity rotation, so a plain delta).
    let lax = ax;
    let lay = ay;
    let laz = az;
    if (bodyA >= 0) {
        const b = bodyA * RB_FLOATS_PER_BODY;
        lax -= bodies[b + F.PX];
        lay -= bodies[b + F.PY];
        laz -= bodies[b + F.PZ];
    }
    let lbx = bx;
    let lby = by;
    let lbz = bz;
    if (bodyB >= 0) {
        const b = bodyB * RB_FLOATS_PER_BODY;
        lbx -= bodies[b + F.PX];
        lby -= bodies[b + F.PY];
        lbz -= bodies[b + F.PZ];
    }

    joints[j + J.TYPE] = type;
    joints[j + J.BODY_A] = bodyA;
    joints[j + J.BODY_B] = bodyB;
    joints[j + J.AX] = lax;
    joints[j + J.AY] = lay;
    joints[j + J.AZ] = laz;
    joints[j + J.BX] = lbx;
    joints[j + J.BY] = lby;
    joints[j + J.BZ] = lbz;

    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;

    if (type === JOINT_TYPE.HINGE) {
        let nx = p0;
        let ny = p1;
        let nz = p2;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 1e-5) {
            nx /= len;
            ny /= len;
            nz /= len;
        } else {
            nx = 0;
            ny = 1;
            nz = 0;
        }
        joints[j + J.P0] = nx;
        joints[j + J.P1] = ny;
        joints[j + J.P2] = nz;

        const axial = dx * nx + dy * ny + dz * nz;
        const rx = dx - axial * nx;
        const ry = dy - axial * ny;
        const rz = dz - axial * nz;
        joints[j + J.P3] = Math.sqrt(rx * rx + ry * ry + rz * rz);
    } else if (type === JOINT_TYPE.SPRING) {
        const measured = Math.sqrt(dx * dx + dy * dy + dz * dz);
        joints[j + J.P0] = p0 < 0 ? measured : Math.max(p0, 0);
        joints[j + J.P1] = clamp(p1, 0, SPRING_MAX_STIFFNESS);
        joints[j + J.P2] = clamp(p2, 0, SPRING_MAX_DAMPING);
        joints[j + J.P3] = 0;
    } else {
        joints[j + J.P0] = 0;
        joints[j + J.P1] = 0;
        joints[j + J.P2] = 0;
        joints[j + J.P3] = 0;
    }

    joints[j + J.FLAGS] = J_FLAG.ACTIVE;
    joints[j + J.SOFTNESS] = 0;
    joints[j + J.USER] = 0;
    return true;
}

/** Allocate an empty fallback joint pool. */
export function createJointPool(): Float32Array {
    return new Float32Array(MAX_JOINTS * J_FLOATS_PER_JOINT);
}
