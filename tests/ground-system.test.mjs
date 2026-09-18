/**
 * Unit tests for ground-height / eye-height reconciliation logic (issue #1265).
 * Imports the real production functions from src/systems/ground-system.ts,
 * driving them deterministically via registerPlatform() (the same mechanism
 * clouds/pads use in production to guarantee a walkable Y regardless of the
 * underlying WASM/JS terrain fallback) instead of relying on raw terrain noise.
 *
 * Run: npm run test:ground (tsx --import ./tests/support/register-hooks.mjs tests/ground-system.test.mjs)
 */

import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/config.ts';
import {
    clearPlatforms,
    getEyeTargetY,
    reconcileGroundedEyeY,
    registerPlatform,
} from '../src/systems/ground-system.ts';

const EYE_HEIGHT = CONFIG.player.eyeHeight;
const PLATFORM_THRESHOLD = CONFIG.ground.platformElevationThreshold;

let passed = 0;
let failed = 0;

function assertLabel(cond, label) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        passed++;
    } else {
        console.error(`  ✗ ${label}`);
        failed++;
    }
}

function test(name, fn) {
    console.log(`\n${name}`);
    clearPlatforms();
    try {
        fn();
    } catch (e) {
        console.error(`  ✗ threw: ${e.stack}`);
        failed++;
    }
}

// Well outside LAKE_BOUNDS (x: -38..78, z: -28..68) so applyLakeModifiers can't
// pull the height toward LAKE_BOTTOM regardless of the platform override.
const FAR_X = 500;
const FAR_Z = 500;

/** Registers a platform whose maxY dominates raw terrain (any noise amplitude), so getGroundHeight is deterministic. */
function fixGroundAt(id, x, z, groundY) {
    registerPlatform({
        id,
        minX: x - 5,
        maxX: x + 5,
        minZ: z - 5,
        maxZ: z + 5,
        minY: groundY - 1,
        maxY: groundY,
    });
}

test('getEyeTargetY adds configured eye height', () => {
    fixGroundAt('p1', FAR_X, FAR_Z, 2.0);
    const eyeY = getEyeTargetY(FAR_X, FAR_Z);
    assertLabel(Math.abs(eyeY - (2.0 + EYE_HEIGHT)) < 0.001, `ground 2 → eye ${2.0 + EYE_HEIGHT}`);
});

test('reconcile: raises when sinking below terrain eye', () => {
    fixGroundAt('p1', FAR_X, FAR_Z, 3.0);
    const eyeY = getEyeTargetY(FAR_X, FAR_Z);
    const y = reconcileGroundedEyeY(2.0, FAR_X, FAR_Z, 0.016, { isGrounded: true, velocityY: 0 });
    assertLabel(Math.abs(y - eyeY) < 1e-6, `snapped up to ground 3 + ${EYE_HEIGHT}`);
});

test('reconcile: smooths downhill when grounded near terrain', () => {
    fixGroundAt('p1', FAR_X, FAR_Z, 2.0);
    const eyeY = getEyeTargetY(FAR_X, FAR_Z);
    const startY = eyeY + 0.8; // was standing on slightly higher ground, within platform threshold
    assert.ok(
        0.8 <= PLATFORM_THRESHOLD,
        'test fixture assumes offset stays within platform threshold'
    );
    const next = reconcileGroundedEyeY(startY, FAR_X, FAR_Z, 0.1, {
        isGrounded: true,
        velocityY: 0,
    });
    assertLabel(next < startY, 'moved down toward new eye target');
    assertLabel(next >= eyeY, 'did not overshoot below eye target');
});

test('reconcile: preserves platform elevation when high above terrain', () => {
    fixGroundAt('p1', FAR_X, FAR_Z, 2.0);
    const platformEyeY = 15.0;
    const y = reconcileGroundedEyeY(platformEyeY, FAR_X, FAR_Z, 0.1, {
        isGrounded: true,
        velocityY: 0,
    });
    assertLabel(y === platformEyeY, 'cloud/platform Y unchanged');
});

test('reconcile: does not pull airborne jumper down', () => {
    fixGroundAt('p1', FAR_X, FAR_Z, 2.0);
    const y = reconcileGroundedEyeY(6.0, FAR_X, FAR_Z, 0.016, {
        isGrounded: false,
        velocityY: 5.0,
    });
    assertLabel(y === 6.0, 'jump arc preserved');
});

console.log(`\n---\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
