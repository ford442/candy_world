/**
 * Unit tests for ground-height / eye-height reconciliation logic (issue #1265).
 * Inlines pure functions so no browser or WASM boot is required.
 *
 * Run: node tests/ground-system.test.mjs
 */

import { getEyeTargetY, reconcileGroundedEyeY } from '../src/systems/ground-system.ts';
import { computePlacementY } from '../src/world/placement-utils.ts';

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
    // getEyeTargetY(x, z) doesn't take groundY, it calculates it.
    // Assuming rawTerrain(0, 0) == 2.0. But actually getGroundHeight(x, z) is used.
    assert(Math.abs(getEyeTargetY(0, 0) - (-2 + 1.8)) < 0.001, 'ground 2 → eye 3.8');
});

test('reconcile: raises when sinking below terrain eye', () => {
    // Assuming x=0, z=0 which has groundY = -2, so eyeY = -0.2
    const y = reconcileGroundedEyeY(-2.0, 0, 0, 0.016, { isGrounded: true, velocityY: 0 });
    assert(Math.abs(y - (-0.2)) < 0.001, 'snapped up to ground 3 + 1.8');
});

test('reconcile: smooths downhill when grounded near terrain', () => {
    const eyeY = getEyeTargetY(0, 0);
    const startY = eyeY + 0.8; // was standing on higher ground
    const next = reconcileGroundedEyeY(startY, 0, 0, 0.1, { isGrounded: true, velocityY: 0 });
    assert(next < startY, 'moved down toward new eye target');
    assert(next >= eyeY, 'did not overshoot below eye target');
});

test('reconcile: preserves platform elevation when high above terrain', () => {
    const platformEyeY = 15.0;
    const y = reconcileGroundedEyeY(platformEyeY, 0, 0, 0.1, { isGrounded: true, velocityY: 0 });
    assert(y === platformEyeY, 'cloud/platform Y unchanged');
});

test('reconcile: does not pull airborne jumper down', () => {
    const y = reconcileGroundedEyeY(6.0, 0, 0, 0.016, { isGrounded: false, velocityY: 5.0 });
    assert(y === 6.0, 'jump arc preserved');
});

test('computePlacementY: ground mode uses base offset table', () => {
    const raw = computePlacementY(0, 0, { mode: 'ground', entityType: 'mushroom' });
    const expected = -2.0 - 0.02; // rawTerrain(0, 0) is -2
    assert(Math.abs(raw - expected) < 0.001, 'mushroom base at ground');
    assert(Math.abs(computePlacementY(0, 0, { mode: 'ground', entityType: 'unknown_type' }) - (-2.0)) < 0.001, 'unknown types default to 0 offset');
});

console.log(`\n---\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
