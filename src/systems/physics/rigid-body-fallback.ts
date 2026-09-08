/**
 * @file rigid-body-fallback.ts
 * @brief Pure-JS mirror of assembly/rigidbody.ts.
 *
 * Used when the AssemblyScript module is unavailable (WASM disabled, init
 * failure, or a non-WebAssembly test environment). It operates on the *same*
 * flat Float32Array layout as the WASM pool so the bridge above it and the
 * debug visualizer are identical on both paths.
 *
 * Deliberate difference from the WASM path: the fallback does not walk the
 * static collision grid (mushroom caps / clouds / gates), which lives in WASM
 * linear memory. Bodies still rest on terrain, collide with each other, get
 * bumped by the player, and stay in world bounds — enough for the props to
 * behave sensibly without WASM, just without landing on platforms.
 */

import { RB_BOUNDS, RB_FIELD as F, RB_FLAG, RB_FLOATS_PER_BODY, RB_SHAPE } from './rigid-body-types.ts';

const GRAVITY = -22.0;
const LINEAR_DAMPING = 0.06;
const MAX_SPEED = 80.0;
const MAX_SUBSTEP = 1 / 120;
const MAX_SUBSTEPS = 8;
const MAX_FRAME_DT = 0.1;

const SLEEP_LINEAR_SPEED = 0.28;
const SLEEP_TIME = 0.6;
const WAKE_SPEED = 0.45;
const SKIN = 0.005;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function bottomExtent(shape: number, d1: number, d2: number): number {
    if (shape === RB_SHAPE.SPHERE) return d1;
    if (shape === RB_SHAPE.CAPSULE) return d2 + d1;
    return d2;
}

function lateralExtent(shape: number, d1: number, d3: number): number {
    return shape === RB_SHAPE.BOX ? Math.max(d1, d3) : d1;
}

function boundingRadius(shape: number, d1: number, d2: number, d3: number): number {
    if (shape === RB_SHAPE.SPHERE) return d1;
    if (shape === RB_SHAPE.CAPSULE) return d2 + d1;
    return Math.sqrt(d1 * d1 + d2 * d2 + d3 * d3);
}

export interface FallbackPlayerProxy {
    active: boolean;
    x: number;
    y: number;
    z: number;
    radius: number;
    height: number;
    vx: number;
    vy: number;
    vz: number;
}

/**
 * Advance the fallback solver in place.
 *
 * @param pool      flat body array, RB_FLOATS_PER_BODY per body
 * @param highWater exclusive upper bound of occupied slots
 * @param dt        frame delta (seconds)
 * @param groundAt  unified ground height sampler
 * @param player    one-way player capsule proxy
 * @param solveJoints per-substep constraint solve, or null when no joints exist
 * @returns number of bodies awake after the step
 */
export function stepRigidBodiesJS(
    pool: Float32Array,
    highWater: number,
    dt: number,
    groundAt: (x: number, z: number) => number,
    player: FallbackPlayerProxy,
    solveJoints: ((h: number) => void) | null = null
): number {
    let remaining = clamp(Number.isFinite(dt) ? dt : 0, 0, MAX_FRAME_DT);
    if (remaining <= 0) return countAwake(pool, highWater);

    let steps = 0;
    while (remaining > 1e-6 && steps < MAX_SUBSTEPS) {
        const h = Math.min(remaining, MAX_SUBSTEP);
        substep(pool, highWater, h, groundAt, player, solveJoints);
        remaining -= h;
        steps++;
    }
    return countAwake(pool, highWater);
}

function countAwake(pool: Float32Array, highWater: number): number {
    let awake = 0;
    for (let id = 0; id < highWater; id++) {
        const b = id * RB_FLOATS_PER_BODY;
        const flags = pool[b + F.FLAGS];
        if (!(flags & RB_FLAG.ACTIVE)) continue;
        if (!(flags & RB_FLAG.SLEEPING)) awake++;
    }
    return awake;
}

function substep(
    pool: Float32Array,
    highWater: number,
    h: number,
    groundAt: (x: number, z: number) => number,
    player: FallbackPlayerProxy,
    solveJoints: ((h: number) => void) | null
): void {
    const damping = clamp(1 - LINEAR_DAMPING * h, 0, 1);

    for (let id = 0; id < highWater; id++) {
        const b = id * RB_FLOATS_PER_BODY;
        const flags = pool[b + F.FLAGS];
        if (!(flags & RB_FLAG.ACTIVE)) continue;
        if (flags & RB_FLAG.SLEEPING) continue;

        if (flags & RB_FLAG.KINEMATIC) {
            pool[b + F.PX] += pool[b + F.VX] * h;
            pool[b + F.PY] += pool[b + F.VY] * h;
            pool[b + F.PZ] += pool[b + F.VZ] * h;
            clampToWorld(pool, b);
            continue;
        }

        let vx = pool[b + F.VX];
        let vy = pool[b + F.VY] + GRAVITY * h;
        let vz = pool[b + F.VZ];

        vx *= damping;
        vy *= damping;
        vz *= damping;

        const spSq = vx * vx + vy * vy + vz * vz;
        if (spSq > MAX_SPEED * MAX_SPEED) {
            const s = MAX_SPEED / Math.sqrt(spSq);
            vx *= s;
            vy *= s;
            vz *= s;
        }

        pool[b + F.PX] += vx * h;
        pool[b + F.PY] += vy * h;
        pool[b + F.PZ] += vz * h;
        pool[b + F.VX] = vx;
        pool[b + F.VY] = vy;
        pool[b + F.VZ] = vz;
        pool[b + F.FLAGS] = flags & ~RB_FLAG.GROUNDED;

        resolveWorldBounds(pool, b);
        resolveTerrain(pool, b, groundAt);
    }

    // Joints run after integration and environment contacts, before body-body:
    // a constraint wins over gravity for the substep, and a contact still gets
    // the last word on penetration. Mirrors substep() in assembly/rigidbody.ts.
    solveJoints?.(h);

    resolveBodyPairs(pool, highWater);
    if (player.active) resolvePlayerProxy(pool, highWater, player);

    for (let id = 0; id < highWater; id++) {
        const b = id * RB_FLOATS_PER_BODY;
        if (!(pool[b + F.FLAGS] & RB_FLAG.ACTIVE)) continue;
        for (let k = F.PX; k <= F.VZ; k++) {
            if (!Number.isFinite(pool[b + k])) {
                for (let z = F.PX; z <= F.VZ; z++) pool[b + z] = 0;
                break;
            }
        }
        clampToWorld(pool, b);
        updateSleep(pool, b, h);
    }
}

function clampToWorld(pool: Float32Array, b: number): void {
    pool[b + F.PX] = clamp(pool[b + F.PX], RB_BOUNDS.minX, RB_BOUNDS.maxX);
    pool[b + F.PY] = clamp(pool[b + F.PY], RB_BOUNDS.minY, RB_BOUNDS.maxY);
    pool[b + F.PZ] = clamp(pool[b + F.PZ], RB_BOUNDS.minZ, RB_BOUNDS.maxZ);
}

function resolveWorldBounds(pool: Float32Array, b: number): void {
    const shape = pool[b + F.SHAPE];
    const r = lateralExtent(shape, pool[b + F.D1], pool[b + F.D3]);
    const rest = pool[b + F.RESTITUTION];

    let x = pool[b + F.PX];
    let z = pool[b + F.PZ];
    let vx = pool[b + F.VX];
    let vz = pool[b + F.VZ];

    if (x - r < RB_BOUNDS.minX) {
        x = RB_BOUNDS.minX + r;
        if (vx < 0) vx = -vx * rest;
    } else if (x + r > RB_BOUNDS.maxX) {
        x = RB_BOUNDS.maxX - r;
        if (vx > 0) vx = -vx * rest;
    }

    if (z - r < RB_BOUNDS.minZ) {
        z = RB_BOUNDS.minZ + r;
        if (vz < 0) vz = -vz * rest;
    } else if (z + r > RB_BOUNDS.maxZ) {
        z = RB_BOUNDS.maxZ - r;
        if (vz > 0) vz = -vz * rest;
    }

    let y = pool[b + F.PY];
    let vy = pool[b + F.VY];
    const top = bottomExtent(shape, pool[b + F.D1], pool[b + F.D2]);
    if (y + top > RB_BOUNDS.maxY) {
        y = RB_BOUNDS.maxY - top;
        if (vy > 0) vy = -vy * rest;
    }

    pool[b + F.PX] = x;
    pool[b + F.PY] = y;
    pool[b + F.PZ] = z;
    pool[b + F.VX] = vx;
    pool[b + F.VY] = vy;
    pool[b + F.VZ] = vz;
}

function resolveTerrain(
    pool: Float32Array,
    b: number,
    groundAt: (x: number, z: number) => number
): void {
    const bottom = bottomExtent(pool[b + F.SHAPE], pool[b + F.D1], pool[b + F.D2]);
    const groundY = groundAt(pool[b + F.PX], pool[b + F.PZ]);
    if (!Number.isFinite(groundY)) return;

    const restY = groundY + bottom;
    if (pool[b + F.PY] <= restY + SKIN) {
        pool[b + F.PY] = restY;
        const vy = pool[b + F.VY];
        if (vy < 0) {
            const bounce = -vy * pool[b + F.RESTITUTION];
            pool[b + F.VY] = bounce > 1 ? bounce : 0;
        }
        const keep = clamp(1 - pool[b + F.FRICTION], 0, 1);
        pool[b + F.VX] *= keep;
        pool[b + F.VZ] *= keep;
        pool[b + F.FLAGS] |= RB_FLAG.GROUNDED;
    }
}

function resolveBodyPairs(pool: Float32Array, highWater: number): void {
    for (let i = 0; i < highWater; i++) {
        const bi = i * RB_FLOATS_PER_BODY;
        const fi = pool[bi + F.FLAGS];
        if (!(fi & RB_FLAG.ACTIVE)) continue;

        const ri = boundingRadius(pool[bi + F.SHAPE], pool[bi + F.D1], pool[bi + F.D2], pool[bi + F.D3]);

        for (let j = i + 1; j < highWater; j++) {
            const bj = j * RB_FLOATS_PER_BODY;
            const fj = pool[bj + F.FLAGS];
            if (!(fj & RB_FLAG.ACTIVE)) continue;
            if (fi & RB_FLAG.SLEEPING && fj & RB_FLAG.SLEEPING) continue;

            const invI = pool[bi + F.INV_MASS];
            const invJ = pool[bj + F.INV_MASS];
            const invSum = invI + invJ;
            if (invSum <= 0) continue;

            const rj = boundingRadius(pool[bj + F.SHAPE], pool[bj + F.D1], pool[bj + F.D2], pool[bj + F.D3]);

            const dx = pool[bj + F.PX] - pool[bi + F.PX];
            const dy = pool[bj + F.PY] - pool[bi + F.PY];
            const dz = pool[bj + F.PZ] - pool[bi + F.PZ];
            const sum = ri + rj;
            const dSq = dx * dx + dy * dy + dz * dz;
            if (dSq >= sum * sum) continue;

            const dist = Math.sqrt(dSq);
            let nx = 0;
            let ny = 1;
            let nz = 0;
            if (dist > 1e-4) {
                nx = dx / dist;
                ny = dy / dist;
                nz = dz / dist;
            }

            const pen = sum - dist;
            const ci = pen * (invI / invSum);
            const cj = pen * (invJ / invSum);
            pool[bi + F.PX] -= nx * ci;
            pool[bi + F.PY] -= ny * ci;
            pool[bi + F.PZ] -= nz * ci;
            pool[bj + F.PX] += nx * cj;
            pool[bj + F.PY] += ny * cj;
            pool[bj + F.PZ] += nz * cj;

            const vn =
                (pool[bj + F.VX] - pool[bi + F.VX]) * nx +
                (pool[bj + F.VY] - pool[bi + F.VY]) * ny +
                (pool[bj + F.VZ] - pool[bi + F.VZ]) * nz;
            if (vn < 0) {
                const e = Math.min(pool[bi + F.RESTITUTION], pool[bj + F.RESTITUTION]);
                const jImp = (-(1 + e) * vn) / invSum;
                pool[bi + F.VX] -= nx * jImp * invI;
                pool[bi + F.VY] -= ny * jImp * invI;
                pool[bi + F.VZ] -= nz * jImp * invI;
                pool[bj + F.VX] += nx * jImp * invJ;
                pool[bj + F.VY] += ny * jImp * invJ;
                pool[bj + F.VZ] += nz * jImp * invJ;
            }

            wakeAt(pool, bi);
            wakeAt(pool, bj);
        }
    }
}

function resolvePlayerProxy(
    pool: Float32Array,
    highWater: number,
    player: FallbackPlayerProxy
): void {
    const capTop = player.y;
    const capBottom = player.y - player.height;

    for (let id = 0; id < highWater; id++) {
        const b = id * RB_FLOATS_PER_BODY;
        if (!(pool[b + F.FLAGS] & RB_FLAG.ACTIVE)) continue;
        if (pool[b + F.INV_MASS] <= 0) continue;

        const bx = pool[b + F.PX];
        const by = pool[b + F.PY];
        const bz = pool[b + F.PZ];
        const r = boundingRadius(pool[b + F.SHAPE], pool[b + F.D1], pool[b + F.D2], pool[b + F.D3]);

        const cy = clamp(by, capBottom, capTop);
        const dx = bx - player.x;
        const dy = by - cy;
        const dz = bz - player.z;
        const sum = r + player.radius;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq >= sum * sum) continue;

        const dist = Math.sqrt(dSq);
        let nx = 1;
        let ny = 0;
        let nz = 0;
        if (dist > 1e-4) {
            nx = dx / dist;
            ny = dy / dist;
            nz = dz / dist;
        }

        const pen = sum - dist;
        pool[b + F.PX] = bx + nx * pen;
        pool[b + F.PY] = by + ny * pen;
        pool[b + F.PZ] = bz + nz * pen;

        const relN =
            (pool[b + F.VX] - player.vx) * nx +
            (pool[b + F.VY] - player.vy) * ny +
            (pool[b + F.VZ] - player.vz) * nz;
        if (relN < 0) {
            const jImp = -(1 + pool[b + F.RESTITUTION]) * relN;
            pool[b + F.VX] += nx * jImp;
            pool[b + F.VY] += ny * jImp;
            pool[b + F.VZ] += nz * jImp;
        }
        wakeAt(pool, b);
    }
}

function wakeAt(pool: Float32Array, b: number): void {
    pool[b + F.FLAGS] &= ~RB_FLAG.SLEEPING;
    pool[b + F.SLEEP] = 0;
}

function updateSleep(pool: Float32Array, b: number, h: number): void {
    const flags = pool[b + F.FLAGS];
    if (flags & RB_FLAG.KINEMATIC) return;

    const vx = pool[b + F.VX];
    const vy = pool[b + F.VY];
    const vz = pool[b + F.VZ];
    const speedSq = vx * vx + vy * vy + vz * vz;

    if (flags & RB_FLAG.SLEEPING) {
        if (speedSq > WAKE_SPEED * WAKE_SPEED) {
            pool[b + F.FLAGS] = flags & ~RB_FLAG.SLEEPING;
            pool[b + F.SLEEP] = 0;
        } else {
            pool[b + F.VX] = 0;
            pool[b + F.VY] = 0;
            pool[b + F.VZ] = 0;
        }
        return;
    }

    const settled = speedSq < SLEEP_LINEAR_SPEED * SLEEP_LINEAR_SPEED && flags & RB_FLAG.GROUNDED;
    if (settled) {
        const t = pool[b + F.SLEEP] + h;
        pool[b + F.SLEEP] = t;
        if (t >= SLEEP_TIME) {
            pool[b + F.FLAGS] = flags | RB_FLAG.SLEEPING;
            pool[b + F.VX] = 0;
            pool[b + F.VY] = 0;
            pool[b + F.VZ] = 0;
        }
    } else {
        pool[b + F.SLEEP] = 0;
    }
}
