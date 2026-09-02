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
