/**
 * @file joint-types.ts
 * @brief Shared layout + component definitions for the joint layer.
 *
 * These constants MUST stay in sync with `assembly/joints.ts` (field offsets
 * and type ids) and `assembly/constants.ts` (capacity). `tests/joints.mjs`
 * asserts the WASM side; the fallback solver in `joint-fallback.ts` reads the
 * same layout.
 */

import type { RigidBodyHandle } from './rigid-body-types.ts';

/** Hard cap on simultaneously solved constraints — see docs/PERF_BUDGETS.md. */
export const MAX_JOINTS = 64;

/** 16 f32 per joint (JOINT_STRIDE = 64 bytes). */
export const J_FLOATS_PER_JOINT = 16;

/** Float indices within one joint record. Mirrors the J_* constants in AS. */
export const J_FIELD = {
    TYPE: 0,
    BODY_A: 1,
    BODY_B: 2,
    /** Anchor on A: A-local offset, or a world point when BODY_A is -1. */
    AX: 3,
    AY: 4,
    AZ: 5,
    /** Anchor on B: B-local offset, or a world point when BODY_B is -1. */
    BX: 6,
    BY: 7,
    BZ: 8,
    /** hinge: axis x | spring: rest length */
    P0: 9,
    /** hinge: axis y | spring: stiffness */
    P1: 10,
    /** hinge: axis z | spring: damping */
    P2: 11,
    /** hinge: arm length */
    P3: 12,
    FLAGS: 13,
    SOFTNESS: 14,
    USER: 15,
} as const;

export const J_FLAG = {
    ACTIVE: 1,
} as const;

export const JOINT_TYPE = {
    FIXED: 0,
    HINGE: 1,
    SPRING: 2,
} as const;

export type JointType = (typeof JOINT_TYPE)[keyof typeof JOINT_TYPE];

/**
 * Documented spring range. Values outside it are clamped by the solver rather
 * than rejected, so an out-of-range `k` soft-limits instead of diverging.
 *
 * The lower bound is a usability floor, not a stability one: gravity is 22 u/s²,
 * so a 1 kg body on a `k = 10` spring sags 2.2 units before it balances.
 */
export const SPRING_RANGE = {
    minStiffness: 10,
    maxStiffness: 4000,
    minDamping: 0,
    maxDamping: 400,
} as const;

/** A body endpoint, or `null` to anchor against the (immovable) world. */
export type JointEnd = RigidBodyHandle | null;

/** Minimal 3-component vector — accepts a THREE.Vector3 without importing one. */
export interface Vec3Like {
    x: number;
    y: number;
    z: number;
}

/** Handle returned by the create* functions. `id` is the pool slot. */
export interface JointHandle {
    readonly id: number;
    readonly type: JointType;
}
