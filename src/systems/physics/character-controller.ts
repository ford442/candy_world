/**
 * character-controller.ts
 *
 * Kinematic first-person character controller (#1577).
 *
 * Owns the movement resolve for the JS-fallback physics path only
 * (`updateJSFallbackMovement`, used in the Melody Lake basin and whenever
 * the C++ path fails) — see the iteration-0 decision in .swarm-state.md for
 * why the native `updatePhysicsCPP` path (emscripten/physics.cpp) is left
 * untouched by this change.
 *
 * Deliberately takes ground-sampling functions as an injected `groundQuery`
 * parameter instead of statically importing ground-system.ts: that module
 * transitively imports the WASM bridge, which uses a Vite-only
 * `?init` wasm import and cannot be loaded under a plain Node/tsx test
 * runner. Injecting the dependency lets this module — and the real,
 * production `resolveCharacterMovement` export — be imported and exercised
 * directly by tests/character-controller.test.mjs.
 *
 * No circular dependencies: only imports THREE, CONFIG, and the
 * PlayerExtended type (type-only, erased at build time).
 */

import * as THREE from 'three';
import { CONFIG } from '../../core/config.ts';
import type { PlayerExtended } from './physics-types.ts';

/** Shape returned by ground-system's sampleGroundFootprint (duplicated as a type-only contract to avoid a runtime import). */
export interface GroundFootprintSample {
    minY: number;
    avgY: number;
    maxY: number;
    normal: THREE.Vector3;
}

export interface CharacterGroundQuery {
    /** Circular footprint ground sample (ground-system.ts: sampleGroundFootprint). */
    sampleFootprint: (
        x: number,
        z: number,
        radius: number,
        points: number
    ) => GroundFootprintSample;
    /** Single-point terrain height (ground-system.ts: getGroundHeight) — spawn-protect re-snap only. */
    getGroundHeight: (x: number, z: number) => number;
}

export interface CharacterMovementOutcome {
    /** True when the controller transitioned from airborne to grounded this frame (before any jump fired on the same frame). */
    justLanded: boolean;
    /**
     * Vertical speed captured at the moment `justLanded` is decided.
     * NOTE: preserves a pre-existing quirk from the JS fallback this
     * replaces — velocity.y is already zeroed by the time this is read on
     * the normal ground-snap path, so it is always 0 there (the "soft
     * landing" FX branch always fires). Not something #1577 asked to fix;
     * left as-is intentionally. See docs/CHARACTER_CONTROLLER.md.
     */
    fallSpeed: number;
}

const _up = new THREE.Vector3(0, 1, 0);
const _tangent = new THREE.Vector3();
const _normal = new THREE.Vector3();

/**
 * Resolve one frame of kinematic character movement: ground/air
 * acceleration, footprint-sampled ground contact, step-up/ledge-block,
 * slope-limit sliding, and coyote-time / jump-buffered jumping.
 *
 * Mutates `player.position`, `player.velocity`, `player.isGrounded`,
 * `player.spawnProtectFrames`, `player.controllerClock`,
 * `player.lastGroundedTime`, and `player.jumpPressedTime`.
 *
 * @param delta Frame time in seconds.
 * @param player Mutable player state.
 * @param targetVelocityXZ Desired horizontal velocity (already camera-relative and speed-scaled).
 * @param jumpHeld Current jump key state (level, not edge).
 * @param jumpTriggered True only on the frame the jump key was pressed (rising edge).
 * @param groundQuery Injected ground-sampling functions (production: sampleGroundFootprint / getGroundHeight from ground-system.ts).
 */
export function resolveCharacterMovement(
    delta: number,
    player: PlayerExtended,
    targetVelocityXZ: { x: number; z: number },
    jumpHeld: boolean,
    jumpTriggered: boolean,
    groundQuery: CharacterGroundQuery
): CharacterMovementOutcome {
    const {
        eyeHeight,
        radius,
        groundAccel,
        airAccel,
        jumpVelocity,
        stepHeight,
        skinWidth,
        coyoteTimeMs,
        jumpBufferMs,
        slopeLimit,
    } = CONFIG.player;
    const footprintSamples = CONFIG.ground.footprintSamples;

    player.controllerClock += delta;

    const wasGrounded = player.isGrounded;

    // --- Separate ground vs air horizontal acceleration ---
    const accel = wasGrounded ? groundAccel : airAccel;
    const smoothing = Math.min(1.0, accel * delta);
    player.velocity.x += (targetVelocityXZ.x - player.velocity.x) * smoothing;
    player.velocity.z += (targetVelocityXZ.z - player.velocity.z) * smoothing;

    // --- Gravity / spawn protection (#1684) ---
    // Spawn-protection: freeze gravity for a few frames after placement so the
    // ground-height query can return a valid value before physics takes over.
    if (player.spawnProtectFrames > 0) {
        player.spawnProtectFrames--;
        player.velocity.y = 0;
        // On the last protected frame re-snap to the authoritative terrain height
        // (both up and down) so probe over-estimates don't leave the player floating.
        if (player.spawnProtectFrames === 0) {
            const snapGroundY = groundQuery.getGroundHeight(player.position.x, player.position.z);
            const snapEyeY = snapGroundY + eyeHeight;
            if (Number.isFinite(snapEyeY)) {
                player.position.y = Math.max(player.position.y, snapEyeY);
                // Only snap downward if clearly floating (> 1 m above terrain eye).
                if (player.position.y > snapEyeY + 1.0) {
                    player.position.y = snapEyeY;
                }
            }
        }
    } else {
        player.velocity.y -= player.gravity * delta;
    }

    const nextX = player.position.x + player.velocity.x * delta;
    const nextZ = player.position.z + player.velocity.z * delta;
    const nextYRaw = player.position.y + player.velocity.y * delta;

    // --- Footprint-sampled ground contact, step-up, and slope resolve ---
    const footprint = groundQuery.sampleFootprint(nextX, nextZ, radius, footprintSamples);
    const destGroundY = footprint.minY;
    const destEyeY = destGroundY + eyeHeight;

    let acceptedX = nextX;
    let acceptedZ = nextZ;
    let acceptedY = nextYRaw;
    let grounded = false;

    if (nextYRaw <= destEyeY + skinWidth && player.velocity.y <= 0) {
        const currentFeetY = player.position.y - eyeHeight;
        const rise = destGroundY - currentFeetY;

        if (rise > stepHeight) {
            // Ledge taller than stepHeight: reject forward motion into it as a
            // movement resolve (stay at current XZ), not a teleport. Falling
            // straight down in place still works if the current footprint
            // permits it.
            acceptedX = player.position.x;
            acceptedZ = player.position.z;
            const curFootprint = groundQuery.sampleFootprint(
                acceptedX,
                acceptedZ,
                radius,
                footprintSamples
            );
            const curEyeY = curFootprint.minY + eyeHeight;
            if (nextYRaw <= curEyeY + skinWidth && player.velocity.y <= 0) {
                acceptedY = curEyeY + skinWidth;
                grounded = true;
                _normal.copy(curFootprint.normal);
            } else {
                acceptedY = nextYRaw;
            }
        } else {
            // Step up (or level ground / small downward step) — resolved as a
            // position snap bounded by stepHeight, not an unconditional teleport.
            acceptedY = destEyeY + skinWidth;
            grounded = true;
            _normal.copy(footprint.normal);
        }
    }

    if (grounded) {
        const angle = Math.acos(THREE.MathUtils.clamp(_normal.y, -1, 1));
        if (angle > slopeLimit) {
            // Too steep to stand on: slide downhill instead of holding footing.
            grounded = false;
            _tangent.copy(_up).cross(_normal).cross(_up).normalize();
            const slideAccel = player.gravity * Math.sin(angle);
            player.velocity.addScaledVector(_tangent, slideAccel * delta);
            acceptedY = player.position.y + player.velocity.y * delta;
        } else {
            player.velocity.y = 0;
        }
    }

    const justLanded = !wasGrounded && grounded;
    const fallSpeed = Math.abs(player.velocity.y);

    if (grounded) {
        player.lastGroundedTime = player.controllerClock;
    }
    if (jumpTriggered) {
        player.jumpPressedTime = player.controllerClock;
    }

    // --- Coyote time + jump buffering ---
    const coyoteSec = coyoteTimeMs / 1000;
    const bufferSec = jumpBufferMs / 1000;
    const canJump = grounded || player.controllerClock - player.lastGroundedTime <= coyoteSec;
    const wantsJump = jumpHeld || player.controllerClock - player.jumpPressedTime <= bufferSec;

    if (canJump && wantsJump) {
        player.velocity.y = jumpVelocity;
        grounded = false;
        // Consume coyote eligibility so a held jump key doesn't keep
        // re-firing every frame for the rest of the original coyote window.
        player.lastGroundedTime = -Infinity;
        // Consume the buffered press so it can't refire on a later landing.
        player.jumpPressedTime = -Infinity;
    }

    player.position.set(acceptedX, acceptedY, acceptedZ);
    player.isGrounded = grounded;

    return { justLanded, fallSpeed };
}
