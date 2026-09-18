/**
 * Unit tests for batch foliage interaction JS fallbacks.
 * Imports the real production functions from src/utils/wasm-foliage-interact.ts.
 *
 * Run: npm run test:foliage-interact (tsx --import ./tests/support/register-hooks.mjs tests/foliage-interact.test.mjs)
 */

import {
    GEYSER_STRIDE,
    PAD_STRIDE,
    VINE_STRIDE,
    geyserLaunchJS,
    padForcesJS,
    vineProximityJS,
} from '../src/utils/wasm-foliage-interact.ts';

let passed = 0;
let failed = 0;

function assert(cond, label) {
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
    try {
        fn();
    } catch (e) {
        console.error(`  ✗ threw: ${e.message}`);
        failed++;
    }
}

test('geyser: no hit when far away', () => {
    const geysers = new Float32Array(GEYSER_STRIDE);
    geysers[3] = 1.0;
    geysers[4] = 5.0;
    const r = geyserLaunchJS(10, 1, 10, 0, 0.016, geysers, 1);
    assert(!r.hit, 'miss when dist > 1.5');
});

test('geyser: lift when in plume', () => {
    const geysers = new Float32Array(GEYSER_STRIDE);
    geysers[3] = 1.0;
    geysers[4] = 5.0;
    const r = geyserLaunchJS(0, 1.0, 0, 0, 0.1, geysers, 1);
    assert(r.hit && r.vy > 0, 'lift in plume');
});

test('pad: snap when bob low', () => {
    const pads = new Float32Array(PAD_STRIDE);
    pads[1] = 2;
    pads[3] = 1;
    pads[4] = 1;
    pads[5] = 0.2;
    const topY = 2.1;
    const r = padForcesJS(0, topY, 0, -1, pads, 1);
    assert(r.hit && r.action === 'snap', 'snap');
});

test('pad: launch when bob high', () => {
    const pads = new Float32Array(PAD_STRIDE);
    pads[1] = 2;
    pads[3] = 1;
    pads[4] = 1;
    pads[5] = 0.8;
    const r = padForcesJS(0, 2.1, 0, 0, pads, 1);
    assert(r.hit && r.action === 'launch' && r.vy === 20, 'launch');
});

test('vine: attach zone', () => {
    const vines = new Float32Array(VINE_STRIDE);
    vines[1] = 10;
    vines[3] = 5;
    const r = vineProximityJS(0.5, 8, 0.2, 0, 0, 0, vines, 1);
    assert(r.inAttachZone && r.candidateIndex === 0, 'attach zone');
});

test('vine: swing plane derived from horizontal velocity when moving', () => {
    const vines = new Float32Array(VINE_STRIDE);
    vines[1] = 10;
    vines[3] = 5;
    const r = vineProximityJS(0.5, 8, 0.2, 2, 0, 0, vines, 1);
    assert(r.inAttachZone, 'still in attach zone while moving');
    assert(
        Math.abs(r.swingPlaneX - 1) < 1e-6,
        `swing plane follows horizontal velocity, got ${r.swingPlaneX}`
    );
});

console.log(`\n---\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
