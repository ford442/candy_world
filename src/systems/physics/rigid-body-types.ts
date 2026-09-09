/**
 * @file rigid-body-types.ts
 * @brief Shared layout + component definition for the dynamic rigid-body layer.
 *
 * These constants MUST stay in sync with `assembly/rigidbody.ts` (field offsets
 * and flag bits) and `assembly/constants.ts` (capacity and world bounds).
 * `tests/rigid-body.mjs` asserts the WASM side; the fallback solver in
 * `rigid-body-fallback.ts` reads the same layout.
 */

/** Hard cap on simultaneously simulated bodies — see docs/PERF_BUDGETS.md. */
export const MAX_DYNAMIC_BODIES = 64;

/** 16 f32 per body (RIGID_BODY_STRIDE = 64 bytes). */
export const RB_FLOATS_PER_BODY = 16;

/** Float indices within one body record. Mirrors the F_* constants in AS. */
export const RB_FIELD = {
    PX: 0,
    PY: 1,
    PZ: 2,
    VX: 3,
    VY: 4,
    VZ: 5,
    INV_MASS: 6,
    RESTITUTION: 7,
    FRICTION: 8,
    D1: 9,
    D2: 10,
    D3: 11,
    SHAPE: 12,
    FLAGS: 13,
    SLEEP: 14,
    USER: 15,
} as const;

export const RB_FLAG = {
    ACTIVE: 1,
    KINEMATIC: 2,
    SLEEPING: 4,
    GROUNDED: 8,
} as const;

export const RB_SHAPE = {
    SPHERE: 0,
    CAPSULE: 1,
    BOX: 2,
} as const;

export type RigidBodyShape = (typeof RB_SHAPE)[keyof typeof RB_SHAPE];

/** World bounds for dynamic bodies. Mirrors RB_* in assembly/constants.ts. */
export const RB_BOUNDS = {
    minX: -128,
    maxX: 128,
    minY: -100,
    maxY: 500,
    minZ: -128,
    maxZ: 128,
} as const;

/**
 * The RigidBody component.
 *
 * Colliders are axis-aligned and rotation-free by design — the solver carries
 * no angular state, so a spinning prop is a *visual* flourish applied by the
 * bridge, not simulated inertia.
 */
export interface RigidBodyDesc {
    /** Collider type. Defaults to sphere. */
    shape?: RigidBodyShape;
    /** Spawn position. */
    x: number;
    y: number;
    z: number;
    /** Mass in kg. `0` or omitted-with-`kinematic` marks the body kinematic. */
    mass?: number;
    /** Bounciness, 0 (dead) .. 0.95 (very bouncy). */
    restitution?: number;
    /** Tangential friction on contact, 0 (ice) .. 1 (velcro). */
    friction?: number;
    /** sphere/capsule radius, or box half-X. */
    radius?: number;
    /** capsule half segment height, or box half-Y. Defaults to `radius`. */
    halfHeight?: number;
    /** box half-Z. Defaults to `radius`. */
    halfDepth?: number;
    /**
     * Kinematic bodies are moved by gameplay code (velocity is integrated, but
     * gravity, impulses and contact response never touch them). Use for
     * scripted platforms that should still shove dynamic props.
     */
    kinematic?: boolean;
    /** Optional Three.js object whose position is synced from the solver. */
    object?: { position: { set(x: number, y: number, z: number): void } };
}

/** Handle returned by `spawnRigidBody`. `id` is the pool slot. */
export interface RigidBodyHandle {
    readonly id: number;
}
