/**
 * @file rigid-bodies.ts
 * @brief TS bridge for the dynamic rigid-body layer.
 *
 * Owns spawn/despawn, the per-frame step, and transform sync to Three.js
 * objects. Prefers the AssemblyScript solver (`assembly/rigidbody.ts`) and
 * transparently falls back to `rigid-body-fallback.ts` when WASM is
 * unavailable — the pool layout is identical on both paths, so callers and the
 * debug visualizer never branch on it.
 *
 * Hot path is allocation-free: the pool is a single Float32Array (a zero-copy
 * view into WASM memory on the fast path) and the sync loop only writes into
 * pre-existing Three.js vectors.
 *
 * Scope: a handful of bumpable props. See docs/PERF_BUDGETS.md for the budget
 * and the explicit non-goals (no vehicles, ragdolls, stacking, soft bodies).
 */

import type * as THREE from 'three';
import { getWasmInstance, getWasmMemory } from '../../utils/wasm-loader-core.ts';
import type { WasmExports } from '../../utils/wasm-loader-types.ts';
import { profiler } from '../../utils/profiler.ts';
import { withinCap } from '../performance-budget/systems-budget.ts';
import { getUnifiedGroundHeightTyped } from '../physics.core.ts';
import { stepRigidBodiesJS, type FallbackPlayerProxy } from './rigid-body-fallback.ts';
import {
    MAX_DYNAMIC_BODIES,
    RB_FIELD as F,
    RB_FLAG,
    RB_FLOATS_PER_BODY,
    RB_SHAPE,
    type RigidBodyDesc,
    type RigidBodyHandle,
} from './rigid-body-types.ts';

export {
    MAX_DYNAMIC_BODIES,
    RB_SHAPE,
    RB_FIELD,
    RB_FLAG,
    RB_FLOATS_PER_BODY,
    RB_BOUNDS,
} from './rigid-body-types.ts';
export type { RigidBodyDesc, RigidBodyHandle, RigidBodyShape } from './rigid-body-types.ts';

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

type SyncTarget = THREE.Object3D | null;

let _initialized = false;
let _useWasm = false;
let _exports: WasmExports | null = null;

/** Byte pointer to the WASM pool; re-used to rebuild the view after a grow. */
let _poolPtr = 0;
let _pool: Float32Array | null = null;
let _poolBuffer: ArrayBufferLike | null = null;

/** Fallback-path bookkeeping (WASM owns these on the fast path). */
let _fallbackHighWater = 0;
let _fallbackCount = 0;

/** id -> Three.js object to drive. Fixed-size, never reallocated. */
const _targets: SyncTarget[] = new Array<SyncTarget>(MAX_DYNAMIC_BODIES).fill(null);

let _highWaterHint = 0;
let _awakeCount = 0;
/** Awake count from the previous frame — see updateRigidBodies(). */
let _prevAwakeCount = 0;

const _playerProxy: FallbackPlayerProxy = {
    active: false,
    x: 0,
    y: 0,
    z: 0,
    radius: 0.5,
    height: 1.8,
    vx: 0,
    vy: 0,
    vz: 0,
};

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------

/**
 * Initialize the rigid-body layer. Idempotent; safe to call before or after
 * WASM is ready (a later call will upgrade a fallback pool to the WASM one).
 *
 * @returns true when the AssemblyScript solver is driving the simulation
 */
export function initRigidBodies(): boolean {
    if (_initialized && _useWasm) return true;

    const instance = getWasmInstance();
    const exports = (instance?.exports ?? null) as WasmExports | null;

    if (exports && typeof exports.initRigidBodySystem === 'function') {
        _exports = exports;
        _poolPtr = exports.initRigidBodySystem();
        _useWasm = _poolPtr > 0;
    }

    if (!_useWasm) {
        _exports = null;
        _pool = new Float32Array(MAX_DYNAMIC_BODIES * RB_FLOATS_PER_BODY);
        _poolBuffer = _pool.buffer;
        console.warn('[RigidBodies] WASM solver unavailable — using JS fallback');
    }

    _targets.fill(null);
    _fallbackHighWater = 0;
    _fallbackCount = 0;
    _highWaterHint = 0;
    _awakeCount = 0;
    _prevAwakeCount = 0;
    _playerProxy.active = false;
    _initialized = true;
    return _useWasm;
}

export function isRigidBodyWasmActive(): boolean {
    return _useWasm;
}

/**
 * The WASM exports driving the solver, or `null` on the fallback path.
 * @internal for the joint bridge (`joints.ts`), which needs the same instance.
 */
export function getRigidBodyExports(): WasmExports | null {
    return _useWasm ? _exports : null;
}

/** Exclusive upper bound of occupied body slots, on whichever path is active. */
export function getRigidBodyHighWater(): number {
    return _useWasm ? _highWaterHint : _fallbackHighWater;
}

/**
 * Joint-layer callbacks for the **JS fallback path only**. Registered by
 * `joints.ts` on init and left `null` otherwise, so a build that never creates
 * a joint pays nothing for them.
 *
 * On the WASM path the AssemblyScript side already wires the equivalents —
 * `solveJoints()` from `substep()`, `jointsOnBodyRemoved()` from `rbDespawn()`,
 * `jointsClear()` from `rbClear()` — and these are never consulted.
 *
 * Registration lives here rather than in `joints.ts` importing us both ways: the
 * dependency is one-directional (joints -> rigid-bodies) and stays that way.
 */
export interface FallbackJointHooks {
    /** Per-substep constraint solve. */
    solve(h: number): void;
    /** A body slot is being freed; drop any joint that referenced it. */
    onBodyRemoved(id: number): void;
    /** Every body is going away. */
    onClear(): void;
}

let _jointHooks: FallbackJointHooks | null = null;

export function setFallbackJointHooks(hooks: FallbackJointHooks | null): void {
    _jointHooks = hooks;
}

/**
 * The shared pool view. Rebuilt only when WASM linear memory grows and
 * detaches the old ArrayBuffer — otherwise this returns the cached view.
 */
export function getRigidBodyPool(): Float32Array | null {
    if (!_useWasm) return _pool;

    // getWasmMemory() hands back the live ArrayBuffer; a memory.grow() swaps it
    // and detaches ours, so compare identity and rebuild only when it changed.
    const buffer = getWasmMemory();
    if (!buffer) return null;
    if (_pool && _poolBuffer === buffer) return _pool;

    _poolBuffer = buffer;
    _pool = new Float32Array(buffer, _poolPtr, MAX_DYNAMIC_BODIES * RB_FLOATS_PER_BODY);
    return _pool;
}

// -----------------------------------------------------------------------------
// Spawn / despawn
// -----------------------------------------------------------------------------

/**
 * Spawn a dynamic body and optionally bind a Three.js object to it.
 * @returns a handle, or `null` when the pool is at MAX_DYNAMIC_BODIES
 */
export function spawnRigidBody(desc: RigidBodyDesc): RigidBodyHandle | null {
    if (!_initialized) initRigidBodies();

    // Budget gate ahead of the pool itself, so the overflow lands in the
    // ?debug=1 systems-budget readout instead of only in the console.
    if (!withinCap('rigidBodies', 'bodies', getRigidBodyCount() + 1)) return null;

    const shape = desc.shape ?? RB_SHAPE.SPHERE;
    const radius = Math.max(desc.radius ?? 0.5, 0.01);
    const halfHeight = Math.max(desc.halfHeight ?? radius, 0.01);
    const halfDepth = Math.max(desc.halfDepth ?? radius, 0.01);
    const mass = desc.kinematic ? 0 : Math.max(desc.mass ?? 1, 0.0001);
    const restitution = desc.restitution ?? 0.3;
    const friction = desc.friction ?? 0.4;

    let id: number;
    if (_useWasm && _exports?.rbSpawn) {
        id = _exports.rbSpawn(
            shape,
            desc.x,
            desc.y,
            desc.z,
            mass,
            restitution,
            friction,
            radius,
            halfHeight,
            halfDepth,
            0
        );
    } else {
        id = spawnFallback(shape, desc, mass, restitution, friction, radius, halfHeight, halfDepth);
    }

    if (id < 0) {
        console.warn(`[RigidBodies] pool full (${MAX_DYNAMIC_BODIES}) — spawn rejected`);
        return null;
    }

    _targets[id] = (desc.object as SyncTarget) ?? null;
    if (id >= _highWaterHint) _highWaterHint = id + 1;
    return { id };
}

function spawnFallback(
    shape: number,
    desc: RigidBodyDesc,
    mass: number,
    restitution: number,
    friction: number,
    d1: number,
    d2: number,
    d3: number
): number {
    const pool = _pool;
    if (!pool) return -1;

    let id = -1;
    for (let i = 0; i < MAX_DYNAMIC_BODIES; i++) {
        if (!(pool[i * RB_FLOATS_PER_BODY + F.FLAGS] & RB_FLAG.ACTIVE)) {
            id = i;
            break;
        }
    }
    if (id < 0) return -1;

    const b = id * RB_FLOATS_PER_BODY;
    pool[b + F.PX] = desc.x;
    pool[b + F.PY] = desc.y;
    pool[b + F.PZ] = desc.z;
    pool[b + F.VX] = 0;
    pool[b + F.VY] = 0;
    pool[b + F.VZ] = 0;
    pool[b + F.INV_MASS] = mass <= 0 ? 0 : 1 / mass;
    pool[b + F.RESTITUTION] = Math.min(Math.max(restitution, 0), 0.95);
    pool[b + F.FRICTION] = Math.min(Math.max(friction, 0), 1);
    pool[b + F.D1] = d1;
    pool[b + F.D2] = d2;
    pool[b + F.D3] = d3;
    pool[b + F.SHAPE] = shape;
    pool[b + F.FLAGS] = RB_FLAG.ACTIVE | (mass <= 0 ? RB_FLAG.KINEMATIC : 0);
    pool[b + F.SLEEP] = 0;
    pool[b + F.USER] = 0;

    if (id >= _fallbackHighWater) _fallbackHighWater = id + 1;
    _fallbackCount++;
    return id;
}

/** Remove a body and unbind its Three.js object. The object is not disposed. */
export function despawnRigidBody(handle: RigidBodyHandle | null): void {
    if (!handle || handle.id < 0 || handle.id >= MAX_DYNAMIC_BODIES) return;
    const id = handle.id;

    if (_useWasm && _exports?.rbDespawn) {
        // AS calls jointsOnBodyRemoved() from inside rbDespawn().
        _exports.rbDespawn(id);
    } else {
        // A joint must never outlive its endpoint and start pulling on a
        // recycled slot, so drop constraints before the slot is freed.
        _jointHooks?.onBodyRemoved(id);
        const pool = _pool;
        if (pool && pool[id * RB_FLOATS_PER_BODY + F.FLAGS] & RB_FLAG.ACTIVE) {
            const b = id * RB_FLOATS_PER_BODY;
            for (let i = 0; i < RB_FLOATS_PER_BODY; i++) pool[b + i] = 0;
            _fallbackCount--;
            while (
                _fallbackHighWater > 0 &&
                !(pool[(_fallbackHighWater - 1) * RB_FLOATS_PER_BODY + F.FLAGS] & RB_FLAG.ACTIVE)
            ) {
                _fallbackHighWater--;
            }
        }
    }
    _targets[id] = null;
}

/** Despawn every body. */
export function clearRigidBodies(): void {
    if (_useWasm && _exports?.rbClear) {
        // AS calls jointsClear() from inside rbClear().
        _exports.rbClear();
    } else if (_pool) {
        _jointHooks?.onClear();
        _pool.fill(0);
        _fallbackHighWater = 0;
        _fallbackCount = 0;
    }
    _targets.fill(null);
    _highWaterHint = 0;
    _awakeCount = 0;
    _prevAwakeCount = 0;
}

export function getRigidBodyCount(): number {
    if (_useWasm && _exports?.rbCount) return _exports.rbCount();
    return _fallbackCount;
}

export function getAwakeRigidBodyCount(): number {
    return _awakeCount;
}

// -----------------------------------------------------------------------------
// Forces
// -----------------------------------------------------------------------------

export function applyRigidBodyImpulse(
    handle: RigidBodyHandle | null,
    ix: number,
    iy: number,
    iz: number
): void {
    if (!handle) return;
    const id = handle.id;

    if (_useWasm && _exports?.rbApplyImpulse) {
        _exports.rbApplyImpulse(id, ix, iy, iz);
        return;
    }
    const pool = _pool;
    if (!pool) return;
    const b = id * RB_FLOATS_PER_BODY;
    if (!(pool[b + F.FLAGS] & RB_FLAG.ACTIVE)) return;
    const invMass = pool[b + F.INV_MASS];
    if (invMass <= 0) return;
    pool[b + F.VX] += ix * invMass;
    pool[b + F.VY] += iy * invMass;
    pool[b + F.VZ] += iz * invMass;
    pool[b + F.FLAGS] &= ~RB_FLAG.SLEEPING;
    pool[b + F.SLEEP] = 0;
}

/**
 * Explosion-style push — the hook for ability hits (rainbow blaster impact,
 * glitch grenade detonation).
 *
 * @param upBias extra upward lean applied to the radial direction (0 = pure radial)
 * @returns number of bodies affected
 */
export function applyRigidBodyRadialImpulse(
    x: number,
    y: number,
    z: number,
    radius: number,
    strength: number,
    upBias = 0.4
): number {
    if (!_initialized || radius <= 0) return 0;

    if (_useWasm && _exports?.rbApplyRadialImpulse) {
        return _exports.rbApplyRadialImpulse(x, y, z, radius, strength, upBias);
    }

    const pool = _pool;
    if (!pool) return 0;
    const rSq = radius * radius;
    let hit = 0;
    for (let id = 0; id < _fallbackHighWater; id++) {
        const b = id * RB_FLOATS_PER_BODY;
        if (!(pool[b + F.FLAGS] & RB_FLAG.ACTIVE)) continue;
        const invMass = pool[b + F.INV_MASS];
        if (invMass <= 0) continue;

        const dx = pool[b + F.PX] - x;
        const dy = pool[b + F.PY] - y;
        const dz = pool[b + F.PZ] - z;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > rSq) continue;

        const dist = Math.sqrt(dSq);
        const falloff = 1 - dist / radius;
        let nx = 0;
        let ny = 1;
        let nz = 0;
        if (dist > 1e-4) {
            nx = dx / dist;
            ny = dy / dist + upBias;
            nz = dz / dist;
            const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (nl > 1e-4) {
                nx /= nl;
                ny /= nl;
                nz /= nl;
            }
        }
        const j = strength * falloff * invMass;
        pool[b + F.VX] += nx * j;
        pool[b + F.VY] += ny * j;
        pool[b + F.VZ] += nz * j;
        pool[b + F.FLAGS] &= ~RB_FLAG.SLEEPING;
        pool[b + F.SLEEP] = 0;
        hit++;
    }
    return hit;
}

// -----------------------------------------------------------------------------
// Per-frame
// -----------------------------------------------------------------------------

/**
 * Publish the player capsule so props can be bumped by walking into them.
 * One-way: the solver never writes back to the player, so the character
 * controller keeps full authority over jump/dash/grounding.
 *
 * @param position player position (y = eye/top of the capsule)
 */
export function setRigidBodyPlayerProxy(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    radius = 0.5,
    height = 1.8
): void {
    if (!_initialized) return;
    _playerProxy.active = true;
    _playerProxy.x = position.x;
    _playerProxy.y = position.y;
    _playerProxy.z = position.z;
    _playerProxy.radius = radius;
    _playerProxy.height = height;
    _playerProxy.vx = velocity.x;
    _playerProxy.vy = velocity.y;
    _playerProxy.vz = velocity.z;

    if (_useWasm && _exports?.rbSetPlayerProxy) {
        _exports.rbSetPlayerProxy(
            position.x,
            position.y,
            position.z,
            radius,
            height,
            velocity.x,
            velocity.y,
            velocity.z
        );
    }
}

/**
 * Step the solver and push the results onto the bound Three.js objects.
 * Cheap no-op when no bodies exist, and skips the sync entirely when every
 * body is asleep.
 *
 * @param delta frame delta in seconds
 * @returns number of bodies awake after the step
 */
export function updateRigidBodies(delta: number): number {
    if (!_initialized) return 0;
    const _t0 = performance.now();
    if (getRigidBodyCount() === 0) {
        _awakeCount = 0;
        _prevAwakeCount = 0;
        return 0;
    }

    if (_useWasm && _exports?.stepRigidBodies) {
        _awakeCount = _exports.stepRigidBodies(delta, performance.now());
    } else {
        const pool = _pool;
        if (!pool) return 0;
        _awakeCount = stepRigidBodiesJS(
            pool,
            _fallbackHighWater,
            delta,
            getUnifiedGroundHeightTyped,
            _playerProxy,
            _jointHooks ? (h) => _jointHooks!.solve(h) : null
        );
    }

    // Sync while anything is awake, plus one trailing frame after the last
    // body sleeps — otherwise a body that settles mid-step leaves its final
    // (sub-unit) displacement unwritten and the mesh sits slightly off.
    if (_awakeCount > 0 || _prevAwakeCount > 0) syncRigidBodyTransforms();
    _prevAwakeCount = _awakeCount;
    profiler.mark('rigidBodies.step', performance.now() - _t0);
    return _awakeCount;
}

/**
 * Copy solver positions onto the bound objects. Zero-allocation: reads the
 * shared pool and writes through the existing Vector3s.
 */
export function syncRigidBodyTransforms(): void {
    const pool = getRigidBodyPool();
    if (!pool) return;

    const limit = _useWasm ? _highWaterHint : _fallbackHighWater;
    for (let id = 0; id < limit; id++) {
        const target = _targets[id];
        if (!target) continue;
        const b = id * RB_FLOATS_PER_BODY;
        if (!(pool[b + F.FLAGS] & RB_FLAG.ACTIVE)) continue;
        target.position.set(pool[b + F.PX], pool[b + F.PY], pool[b + F.PZ]);
    }
}
