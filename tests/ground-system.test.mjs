/**
 * Unit tests for ground-height / eye-height reconciliation logic (issue #1265).
 * Inlines pure functions so no browser or WASM boot is required.
 *
 * Run: node tests/ground-system.test.mjs
 */

const EYE_HEIGHT = 1.8;
const PLATFORM_THRESHOLD = 1.25;
const FOLLOW_LERP_SPEED = 12.0;
const FOLLOW_MAX_STEP = 2.5;

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function getEyeTargetY(groundY) {
    return groundY + EYE_HEIGHT;
}

function reconcileGroundedEyeY(currentY, groundY, delta, { isGrounded, velocityY }) {
    const eyeY = getEyeTargetY(groundY);

    if (currentY < eyeY) {
        return eyeY;
    }

    if (!isGrounded || velocityY > 0.05) {
        return currentY;
    }

    const heightAboveTerrain = currentY - eyeY;
    if (heightAboveTerrain > PLATFORM_THRESHOLD) {
        return currentY;
    }

    let nextY = lerp(currentY, eyeY, Math.min(delta * FOLLOW_LERP_SPEED, 1.0));
    nextY = clamp(nextY, currentY - FOLLOW_MAX_STEP, currentY + FOLLOW_MAX_STEP);
    return nextY;
}

const ENTITY_BASE_OFFSETS = { mushroom: 0, tree: 0 };

function computePlacementY(groundY, entityType) {
    return groundY + (ENTITY_BASE_OFFSETS[entityType] ?? 0);
}

// ---- harness ----

let passed = 0;
let failed = 0;

function assert(cond, label) {
    if (cond) { console.log(`  ✓ ${label}`); passed++; }
    else { console.error(`  ✗ ${label}`); failed++; }
}

function test(name, fn) {
    console.log(`\n${name}`);
    try { fn(); } catch (e) { console.error(`  ✗ threw: ${e.message}`); failed++; }
}

// ---- tests ----

test('getEyeTargetY adds configured eye height', () => {
    assert(Math.abs(getEyeTargetY(2.0) - 3.8) < 0.001, 'ground 2 → eye 3.8');
});

test('reconcile: raises when sinking below terrain eye', () => {
    const y = reconcileGroundedEyeY(2.0, 3.0, 0.016, { isGrounded: true, velocityY: 0 });
    assert(y === 4.8, 'snapped up to ground 3 + 1.8');
});

test('reconcile: smooths downhill when grounded near terrain', () => {
    const groundY = 2.0;
    const eyeY = getEyeTargetY(groundY);
    const startY = eyeY + 0.8; // was standing on higher ground
    const next = reconcileGroundedEyeY(startY, groundY, 0.1, { isGrounded: true, velocityY: 0 });
    assert(next < startY, 'moved down toward new eye target');
    assert(next >= eyeY, 'did not overshoot below eye target');
});

test('reconcile: preserves platform elevation when high above terrain', () => {
    const groundY = 2.0;
    const platformEyeY = 15.0;
    const y = reconcileGroundedEyeY(platformEyeY, groundY, 0.1, { isGrounded: true, velocityY: 0 });
    assert(y === platformEyeY, 'cloud/platform Y unchanged');
});

test('reconcile: does not pull airborne jumper down', () => {
    const y = reconcileGroundedEyeY(6.0, 2.0, 0.016, { isGrounded: false, velocityY: 5.0 });
    assert(y === 6.0, 'jump arc preserved');
});

test('computePlacementY: ground mode uses base offset table', () => {
    assert(computePlacementY(4.2, 'mushroom') === 4.2, 'mushroom base at ground');
    assert(computePlacementY(4.2, 'unknown_type') === 4.2, 'unknown types default to 0 offset');
});

console.log(`\n---\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
