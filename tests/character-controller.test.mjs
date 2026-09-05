import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Mocking CONFIG
const MOCK_CONFIG = {
    player: {
        stepHeight: 0.35,
        coyoteTimeMs: 100,
        jumpBufferMs: 100,
        skinWidth: 0.05,
        airAccel: 5.0,
        eyeHeight: 1.8,
    },
    ground: {
        maxSlopeAngle: (25 * Math.PI) / 180,
        footprintRadius: { player: 0.3 },
        footprintSamples: 4,
    }
};

// Mocking dependencies
const mockSampleGroundFootprint = (x, z, radius, samples) => {
    return { minY: 0, avgY: 0, maxY: 0, pointMin: new THREE.Vector3(), pointMax: new THREE.Vector3() };
};

const mockSampleGroundNormal = (x, z) => {
    return new THREE.Vector3(0, 1, 0); // Flat ground
};

// --- Test Subject Injection ---
const _targetVelocity = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

class CharacterController {
    update(delta, player, keyStates, moveInput, moveSpeed, now, groundMocks) {
        const { stepHeight, skinWidth, airAccel } = MOCK_CONFIG.player;
        const { maxSlopeAngle, footprintRadius } = MOCK_CONFIG.ground;

        _targetVelocity.copy(moveInput).multiplyScalar(moveSpeed);
        const isGroundedPrev = player.isGrounded;

        if (isGroundedPrev) {
            const smoothing = Math.min(1.0, 15.0 * delta);
            player.velocity.x += (_targetVelocity.x - player.velocity.x) * smoothing;
            player.velocity.z += (_targetVelocity.z - player.velocity.z) * smoothing;
        } else {
            const airSmoothing = Math.min(1.0, airAccel * delta);
            player.velocity.x += (_targetVelocity.x - player.velocity.x) * airSmoothing;
            player.velocity.z += (_targetVelocity.z - player.velocity.z) * airSmoothing;
        }

        player.velocity.y -= player.gravity * delta;

        const nextX = player.position.x + player.velocity.x * delta;
        const nextZ = player.position.z + player.velocity.z * delta;
        const nextYRaw = player.position.y + player.velocity.y * delta;

        const radius = footprintRadius['player'] ?? 0.3;
        const footprint = groundMocks.sampleGroundFootprint(nextX, nextZ, radius, MOCK_CONFIG.ground.footprintSamples);
        const destGroundY = footprint.minY;
        const eyeY = destGroundY + MOCK_CONFIG.player.eyeHeight;

        let acceptedX = nextX;
        let acceptedZ = nextZ;
        let acceptedY = nextYRaw;
        let newlyGrounded = false;

        if (nextYRaw <= eyeY + skinWidth && player.velocity.y <= 0) {
            const rise = destGroundY - (player.position.y - MOCK_CONFIG.player.eyeHeight);

            if (rise > 0) {
                if (rise <= stepHeight && player.velocity.y > -15.0) {
                    acceptedY = eyeY + skinWidth;
                    newlyGrounded = true;
                } else {
                    acceptedX = player.position.x;
                    acceptedZ = player.position.z;
                    const curFootprint = groundMocks.sampleGroundFootprint(acceptedX, acceptedZ, radius, MOCK_CONFIG.ground.footprintSamples);
                    const curEyeY = curFootprint.minY + MOCK_CONFIG.player.eyeHeight;
                    if (nextYRaw <= curEyeY + skinWidth) {
                        acceptedY = curEyeY + skinWidth;
                        newlyGrounded = true;
                    }
                }
            } else {
                acceptedY = eyeY + skinWidth;
                newlyGrounded = true;
            }
        }

        if (newlyGrounded) {
            const normal = groundMocks.sampleGroundNormal(acceptedX, acceptedZ);
            const angle = Math.acos(THREE.MathUtils.clamp(normal.y, -1, 1));

            if (angle > maxSlopeAngle) {
                newlyGrounded = false;
                _tangent.copy(_up).cross(normal).cross(_up).normalize();
                const slideAccel = player.gravity * Math.sin(angle);
                player.velocity.addScaledVector(_tangent, slideAccel * delta);
                acceptedY = player.position.y + player.velocity.y * delta;
            } else {
                player.velocity.y = 0;
            }
        }

        const canJump = newlyGrounded || (now - player.lastGroundedTime <= MOCK_CONFIG.player.coyoteTimeMs);
        const wantsJump = keyStates.jump || (now - player.jumpBufferTime <= MOCK_CONFIG.player.jumpBufferMs);
        if (canJump && wantsJump) {
            player.velocity.y = 8.0;
            newlyGrounded = false;
        }

        player.position.set(acceptedX, acceptedY, acceptedZ);
        player.isGrounded = newlyGrounded;
    }
}

test('CharacterController - Flat Ground Walk', () => {
    const controller = new CharacterController();
    const player = {
        position: new THREE.Vector3(0, 1.8, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        isGrounded: true,
        gravity: 21.5
    };
    const keyStates = { jump: false };
    const mocks = {
        sampleGroundFootprint: () => ({ minY: 0 }),
        sampleGroundNormal: () => new THREE.Vector3(0, 1, 0)
    };

    controller.update(0.016, player, keyStates, new THREE.Vector3(1, 0, 0), 10, 1000, mocks);

    assert.strictEqual(player.isGrounded, true);
    assert.ok(player.velocity.x > 0);
    assert.strictEqual(player.velocity.y, 0);
});

test('CharacterController - Valid Step Up (0.3m)', () => {
    const controller = new CharacterController();
    const player = {
        position: new THREE.Vector3(0, 1.8, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        isGrounded: true,
        gravity: 21.5
    };
    const keyStates = { jump: false };
    const mocks = {
        sampleGroundFootprint: (x, z) => ({ minY: 0.3 }),
        sampleGroundNormal: () => new THREE.Vector3(0, 1, 0)
    };

    controller.update(0.016, player, keyStates, new THREE.Vector3(1, 0, 0), 10, 1000, mocks);

    assert.strictEqual(player.isGrounded, true);
    assert.ok(Math.abs(player.position.y - 2.15) < 0.001);
});

test('CharacterController - Invalid Step Up (0.8m) block', () => {
    const controller = new CharacterController();
    const player = {
        position: new THREE.Vector3(0, 1.8, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        isGrounded: true,
        gravity: 21.5
    };
    const keyStates = { jump: false };
    const mocks = {
        sampleGroundFootprint: (x, z) => {
            if (x === 0 && z === 0) return { minY: 0 };
            return { minY: 0.8 };
        },
        sampleGroundNormal: () => new THREE.Vector3(0, 1, 0)
    };

    controller.update(0.016, player, keyStates, new THREE.Vector3(1, 0, 0), 10, 1000, mocks);

    assert.strictEqual(player.position.x, 0);
    assert.strictEqual(player.position.z, 0);
});

test('CharacterController - Slope sliding on 50 degree angle', () => {
    const controller = new CharacterController();
    const player = {
        position: new THREE.Vector3(0, 1.8, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        isGrounded: false,
        gravity: 21.5
    };
    const keyStates = { jump: false };
    const angle = (50 * Math.PI) / 180;
    const ny = Math.cos(angle);
    const nx = Math.sin(angle);
    const mocks = {
        sampleGroundFootprint: () => ({ minY: 0 }),
        sampleGroundNormal: () => new THREE.Vector3(nx, ny, 0).normalize()
    };

    controller.update(0.016, player, keyStates, new THREE.Vector3(1, 0, 0), 10, 1000, mocks);

    assert.strictEqual(player.isGrounded, false);
    assert.ok(player.velocity.y < 0);
});

test('CharacterController - Coyote Time Jump (within 100ms grace)', () => {
    const controller = new CharacterController();
    const player = {
        position: new THREE.Vector3(0, 5, 0),
        velocity: new THREE.Vector3(0, -5, 0),
        isGrounded: false,
        gravity: 21.5,
        lastGroundedTime: 950,
        jumpBufferTime: 0
    };

    const keyStates = { jump: true };
    const mocks = {
        sampleGroundFootprint: () => ({ minY: 0 }),
        sampleGroundNormal: () => new THREE.Vector3(0, 1, 0)
    };

    controller.update(0.016, player, keyStates, new THREE.Vector3(0, 0, 0), 10, 1000, mocks);

    assert.strictEqual(player.velocity.y, 8.0);
});

test('CharacterController - Jump Buffer (input early, lands later)', () => {
    const controller = new CharacterController();
    const player = {
        position: new THREE.Vector3(0, 1.8, 0),
        velocity: new THREE.Vector3(0, -5, 0),
        isGrounded: false,
        gravity: 21.5,
        lastGroundedTime: 0,
        jumpBufferTime: 950
    };

    const keyStates = { jump: false };
    const mocks = {
        sampleGroundFootprint: () => ({ minY: 0 }),
        sampleGroundNormal: () => new THREE.Vector3(0, 1, 0)
    };

    controller.update(0.016, player, keyStates, new THREE.Vector3(0, 0, 0), 10, 1000, mocks);

    assert.strictEqual(player.velocity.y, 8.0);
    assert.strictEqual(player.isGrounded, false);
});
