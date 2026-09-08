/**
 * Unit tests for the kinematic character controller (#1577).
 *
 * Imports the REAL production controller from src/ — no inline fake, no
 * mocked CONFIG. Ground-sampling functions are injected per-call (the
 * controller's own design: see character-controller.ts), which is what
 * lets this run headlessly under tsx without booting the WASM/Vite chain
 * that ground-system.ts pulls in.
 *
 * Run: npm run test:character (tsx tests/character-controller.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/core/config.ts';
import { resolveCharacterMovement } from '../src/systems/physics/character-controller.ts';

const FLAT_NORMAL = new THREE.Vector3(0, 1, 0);
const DELTA = 1 / 60;

function makePlayer(overrides = {}) {
    return {
        position: new THREE.Vector3(0, CONFIG.player.eyeHeight, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        isGrounded: true,
        gravity: 21.5,
        spawnProtectFrames: 0,
        controllerClock: 0,
        lastGroundedTime: -Infinity,
        jumpPressedTime: -Infinity,
        ...overrides,
    };
}

/** Ground query that always reports flat, level ground at y=0. */
function flatGroundQuery() {
    return {
        sampleFootprint: () => ({ minY: 0, avgY: 0, maxY: 0, normal: FLAT_NORMAL.clone() }),
        getGroundHeight: () => 0,
    };
}

/** Ground query the player never reaches (used to isolate coyote/jump logic from ground contact). */
function unreachableGroundQuery() {
    return {
        sampleFootprint: () => ({
            minY: -1000,
            avgY: -1000,
            maxY: -1000,
            normal: FLAT_NORMAL.clone(),
        }),
        getGroundHeight: () => -1000,
    };
}

test('ground/air acceleration: grounded walk accelerates toward target velocity', () => {
    const player = makePlayer({ isGrounded: true });
    const groundQuery = flatGroundQuery();
    resolveCharacterMovement(DELTA, player, { x: 10, z: 0 }, false, false, groundQuery);
    assert.ok(player.velocity.x > 0, 'gains horizontal velocity toward target');
    assert.equal(player.isGrounded, true);
    assert.equal(player.velocity.y, 0, 'flat ground zeroes vertical velocity');
});

test('walkable slope holds footing (angle under CONFIG.player.slopeLimit)', () => {
    const walkableAngle = CONFIG.player.slopeLimit * 0.5;
    const nx = Math.sin(walkableAngle);
    const ny = Math.cos(walkableAngle);
    const player = makePlayer({
        position: new THREE.Vector3(0, CONFIG.player.eyeHeight + 0.001, 0),
        velocity: new THREE.Vector3(0, -1, 0),
        isGrounded: false,
    });
    const groundQuery = {
        sampleFootprint: () => ({
            minY: 0,
            avgY: 0,
            maxY: 0,
            normal: new THREE.Vector3(nx, ny, 0).normalize(),
        }),
        getGroundHeight: () => 0,
    };
    resolveCharacterMovement(DELTA, player, { x: 0, z: 0 }, false, false, groundQuery);
    assert.equal(player.isGrounded, true, 'walkable slope grounds the player');
    assert.equal(player.velocity.y, 0);
});

test('steep slope past CONFIG.player.slopeLimit slides instead of holding footing', () => {
    const steepAngle = CONFIG.player.slopeLimit + (10 * Math.PI) / 180;
    const nx = Math.sin(steepAngle);
    const ny = Math.cos(steepAngle);
    const player = makePlayer({
        position: new THREE.Vector3(0, CONFIG.player.eyeHeight + 0.001, 0),
        velocity: new THREE.Vector3(0, -1, 0),
        isGrounded: false,
    });
    const groundQuery = {
        sampleFootprint: () => ({
            minY: 0,
            avgY: 0,
            maxY: 0,
            normal: new THREE.Vector3(nx, ny, 0).normalize(),
        }),
        getGroundHeight: () => 0,
    };
    resolveCharacterMovement(DELTA, player, { x: 0, z: 0 }, false, false, groundQuery);
    assert.equal(
        player.isGrounded,
        false,
        'surface steeper than slopeLimit does not grant footing'
    );
    assert.ok(player.velocity.y < 0, 'still falling, not snapped to the slope');
    assert.ok(player.velocity.x !== 0, 'gravity-along-slope impulse pushes the player downhill');
});

test('step under CONFIG.player.stepHeight climbs the ledge', () => {
    const rise = CONFIG.player.stepHeight * 0.5;
    const player = makePlayer({
        position: new THREE.Vector3(0, CONFIG.player.eyeHeight, 0),
        velocity: new THREE.Vector3(5, 0, 0),
        isGrounded: true,
    });
    const groundQuery = {
        sampleFootprint: (x) =>
            x > 0.01
                ? { minY: rise, avgY: rise, maxY: rise, normal: FLAT_NORMAL.clone() }
                : { minY: 0, avgY: 0, maxY: 0, normal: FLAT_NORMAL.clone() },
        getGroundHeight: () => 0,
    };
    resolveCharacterMovement(DELTA, player, { x: 5, z: 0 }, false, false, groundQuery);
    assert.ok(player.position.x > 0, 'forward motion is accepted');
    assert.equal(player.isGrounded, true);
    assert.ok(
        Math.abs(player.position.y - (rise + CONFIG.player.eyeHeight + CONFIG.player.skinWidth)) <
            1e-6,
        'snaps up onto the ledge'
    );
});

test('ledge over CONFIG.player.stepHeight blocks forward motion', () => {
    const rise = CONFIG.player.stepHeight + 0.5;
    const startX = 0;
    const player = makePlayer({
        position: new THREE.Vector3(startX, CONFIG.player.eyeHeight, 0),
        velocity: new THREE.Vector3(5, 0, 0),
        isGrounded: true,
    });
    const groundQuery = {
        sampleFootprint: (x) =>
            Math.abs(x - startX) > 0.01
                ? { minY: rise, avgY: rise, maxY: rise, normal: FLAT_NORMAL.clone() }
                : { minY: 0, avgY: 0, maxY: 0, normal: FLAT_NORMAL.clone() },
        getGroundHeight: () => 0,
    };
    resolveCharacterMovement(DELTA, player, { x: 5, z: 0 }, false, false, groundQuery);
    assert.equal(
        player.position.x,
        startX,
        'a wall taller than stepHeight rejects forward motion (movement resolve, not a teleport)'
    );
    assert.equal(player.isGrounded, true, 'still standing on the ground it started on');
});

test('coyote time: jump fires within CONFIG.player.coyoteTimeMs of leaving ground', () => {
    const player = makePlayer({
        position: new THREE.Vector3(0, 50, 0),
        velocity: new THREE.Vector3(0, -5, 0),
        isGrounded: false,
        controllerClock: 1.0,
        lastGroundedTime: 1.0 - (CONFIG.player.coyoteTimeMs / 1000) * 0.5,
    });
    resolveCharacterMovement(DELTA, player, { x: 0, z: 0 }, true, true, unreachableGroundQuery());
    assert.equal(
        player.velocity.y,
        CONFIG.player.jumpVelocity,
        'coyote window still allows the jump to fire'
    );
});

test('coyote time: jump does not fire once CONFIG.player.coyoteTimeMs has expired', () => {
    const player = makePlayer({
        position: new THREE.Vector3(0, 50, 0),
        velocity: new THREE.Vector3(0, -5, 0),
        isGrounded: false,
        controllerClock: 1.0,
        lastGroundedTime: 1.0 - CONFIG.player.coyoteTimeMs / 1000 - 0.05,
    });
    resolveCharacterMovement(DELTA, player, { x: 0, z: 0 }, true, true, unreachableGroundQuery());
    assert.notEqual(
        player.velocity.y,
        CONFIG.player.jumpVelocity,
        'expired coyote window does not grant a jump'
    );
    assert.ok(player.velocity.y < 0, 'still falling under gravity');
});

test('coyote time: a held jump does not refire on the next airborne frame', () => {
    // Regression test: firing a coyote-window jump must consume
    // lastGroundedTime, otherwise a held jump key keeps resetting
    // velocity.y to jumpVelocity every frame for the rest of the original
    // coyote window instead of a single impulse.
    const player = makePlayer({
        position: new THREE.Vector3(0, 50, 0),
        velocity: new THREE.Vector3(0, -5, 0),
        isGrounded: false,
        controllerClock: 1.0,
        lastGroundedTime: 1.0 - (CONFIG.player.coyoteTimeMs / 1000) * 0.5,
    });
    resolveCharacterMovement(DELTA, player, { x: 0, z: 0 }, true, true, unreachableGroundQuery());
    assert.equal(player.velocity.y, CONFIG.player.jumpVelocity, 'first frame: coyote jump fires');

    // Still well within the original coyote window, and jump is still held.
    resolveCharacterMovement(DELTA, player, { x: 0, z: 0 }, true, false, unreachableGroundQuery());
    assert.ok(
        player.velocity.y < CONFIG.player.jumpVelocity,
        'second frame: gravity should have reduced velocity, not refired the jump'
    );
});

test('jump buffer: a press shortly before landing fires on contact', () => {
    const player = makePlayer({
        position: new THREE.Vector3(0, CONFIG.player.eyeHeight + 0.001, 0),
        velocity: new THREE.Vector3(0, -0.5, 0),
        isGrounded: false,
        controllerClock: 1.0,
        jumpPressedTime: 1.0 - (CONFIG.player.jumpBufferMs / 1000) * 0.5,
    });
    // jumpHeld=false: the key may already be released — only the earlier
    // buffered press should matter.
    resolveCharacterMovement(DELTA, player, { x: 0, z: 0 }, false, false, flatGroundQuery());
    assert.equal(
        player.velocity.y,
        CONFIG.player.jumpVelocity,
        'buffered jump fires immediately on ground contact'
    );
    assert.equal(player.isGrounded, false, 'the fired jump leaves the player airborne again');
});

test('jump buffer: a press outside CONFIG.player.jumpBufferMs does not carry over', () => {
    const player = makePlayer({
        position: new THREE.Vector3(0, CONFIG.player.eyeHeight + 0.001, 0),
        velocity: new THREE.Vector3(0, -0.5, 0),
        isGrounded: false,
        controllerClock: 1.0,
        jumpPressedTime: 1.0 - CONFIG.player.jumpBufferMs / 1000 - 0.05,
    });
    resolveCharacterMovement(DELTA, player, { x: 0, z: 0 }, false, false, flatGroundQuery());
    assert.notEqual(
        player.velocity.y,
        CONFIG.player.jumpVelocity,
        'stale buffered press is not consumed'
    );
    assert.equal(player.isGrounded, true, 'lands normally instead');
});

test('isGrounded does not chatter across frames on flat ground (skinWidth hysteresis)', () => {
    const player = makePlayer({ isGrounded: true });
    const groundQuery = flatGroundQuery();
    for (let frame = 0; frame < 30; frame++) {
        resolveCharacterMovement(DELTA, player, { x: 0, z: 0 }, false, false, groundQuery);
        assert.equal(
            player.isGrounded,
            true,
            `frame ${frame}: isGrounded flickered on stable flat ground`
        );
    }
});

// ---------------------------------------------------------------------------
// Regression guards added 2026-09-08 alongside the branch-split measurement
// (see docs/CHARACTER_CONTROLLER.md and .swarm-state.md iteration 0).
// ---------------------------------------------------------------------------

test('ground and air acceleration are actually different (not one shared constant)', () => {
    assert.notEqual(
        CONFIG.player.groundAccel,
        CONFIG.player.airAccel,
        'the config values themselves must differ or this test proves nothing'
    );

    const target = { x: 10, z: 0 };
    // Ground query the player never reaches, so the only difference between
    // the two runs is the isGrounded flag the controller reads for accel.
    const grounded = makePlayer({ isGrounded: true });
    resolveCharacterMovement(DELTA, grounded, target, false, false, unreachableGroundQuery());
    const groundedGain = grounded.velocity.x;

    const airborne = makePlayer({ isGrounded: false });
    resolveCharacterMovement(DELTA, airborne, target, false, false, unreachableGroundQuery());
    const airborneGain = airborne.velocity.x;

    assert.ok(groundedGain > 0 && airborneGain > 0, 'both states accelerate toward the target');
    assert.ok(
        groundedGain > airborneGain,
        `grounded accel (${groundedGain}) must outpace air accel (${airborneGain})`
    );
    // Pin the ratio to the config so a future edit to one constant that
    // accidentally reuses the other is caught here.
    assert.ok(
        Math.abs(groundedGain / airborneGain - CONFIG.player.groundAccel / CONFIG.player.airAccel) <
            0.01,
        'velocity gain ratio should track the groundAccel/airAccel ratio'
    );
});

test('slope limit reads CONFIG.player.slopeLimit, not CONFIG.ground.maxSlopeAngle (#1302 coupling guard)', () => {
    // CONFIG.ground.maxSlopeAngle is the prop-placement constant from #1302
    // and is deliberately much shallower than the player's slope limit.
    // A surface between the two must still be walkable: if the controller ever
    // gets coupled back to the ground constant, this fails.
    assert.ok(
        CONFIG.ground.maxSlopeAngle < CONFIG.player.slopeLimit,
        'fixture assumes the prop-placement limit is the shallower of the two'
    );
    const between = (CONFIG.ground.maxSlopeAngle + CONFIG.player.slopeLimit) / 2;
    const player = makePlayer({
        position: new THREE.Vector3(0, CONFIG.player.eyeHeight + 0.001, 0),
        velocity: new THREE.Vector3(0, -1, 0),
        isGrounded: false,
    });
    const groundQuery = {
        sampleFootprint: () => ({
            minY: 0,
            avgY: 0,
            maxY: 0,
            normal: new THREE.Vector3(Math.sin(between), Math.cos(between), 0).normalize(),
        }),
        getGroundHeight: () => 0,
    };
    resolveCharacterMovement(DELTA, player, { x: 0, z: 0 }, false, false, groundQuery);
    assert.equal(
        player.isGrounded,
        true,
        'a slope steeper than CONFIG.ground.maxSlopeAngle but under CONFIG.player.slopeLimit is walkable'
    );
});

test('steep slope slides downhill, in the downhill direction', () => {
    const steepAngle = CONFIG.player.slopeLimit + (10 * Math.PI) / 180;
    // Normal tilted toward +x means the surface falls away toward +x, so the
    // slide impulse must be +x. A sign error here would still pass the
    // existing "velocity.x !== 0" assertion.
    const normal = new THREE.Vector3(Math.sin(steepAngle), Math.cos(steepAngle), 0).normalize();
    const player = makePlayer({
        position: new THREE.Vector3(0, CONFIG.player.eyeHeight + 0.001, 0),
        velocity: new THREE.Vector3(0, -1, 0),
        isGrounded: false,
    });
    const groundQuery = {
        sampleFootprint: () => ({ minY: 0, avgY: 0, maxY: 0, normal: normal.clone() }),
        getGroundHeight: () => 0,
    };
    resolveCharacterMovement(DELTA, player, { x: 0, z: 0 }, false, false, groundQuery);
    assert.ok(
        player.velocity.x > 0,
        `slide impulse must point downhill (+x), got ${player.velocity.x}`
    );
    assert.equal(player.velocity.z, 0, 'no cross-axis drift on a slope tilted purely in x');
});

test('slide accumulates over consecutive frames on a steep slope', () => {
    const steepAngle = CONFIG.player.slopeLimit + (20 * Math.PI) / 180;
    const normal = new THREE.Vector3(Math.sin(steepAngle), Math.cos(steepAngle), 0).normalize();
    const player = makePlayer({
        position: new THREE.Vector3(0, CONFIG.player.eyeHeight + 0.001, 0),
        velocity: new THREE.Vector3(0, -1, 0),
        isGrounded: false,
    });
    const groundQuery = {
        sampleFootprint: () => ({ minY: 0, avgY: 0, maxY: 0, normal: normal.clone() }),
        getGroundHeight: () => 0,
    };
    let previous = 0;
    for (let frame = 0; frame < 5; frame++) {
        resolveCharacterMovement(DELTA, player, { x: 0, z: 0 }, false, false, groundQuery);
        assert.ok(
            player.velocity.x > previous,
            `frame ${frame}: downhill speed should keep building, got ${player.velocity.x} after ${previous}`
        );
        previous = player.velocity.x;
    }
    assert.equal(player.isGrounded, false, 'never regains footing on an over-limit slope');
});
