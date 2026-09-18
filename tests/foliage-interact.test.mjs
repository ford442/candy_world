/**
 * Unit tests for batch foliage interaction JS fallbacks.
 * Inlines pure functions (no wasm-loader import — avoids Vite/UI graph).
 *
 * Run: node tests/foliage-interact.test.mjs
 */

const GEYSER_STRIDE = 5;
const PAD_STRIDE = 6;
const VINE_STRIDE = 4;

function geyserLaunchJS(px, py, pz, pvy, delta, geysers, count) {
    let vy = pvy;
    let hit = false;
    const radiusSq = 2.25;
    const baseHeight = 0.5;
    for (let i = 0; i < count; i++) {
        const base = i * GEYSER_STRIDE;
        const gx = geysers[base], gy = geysers[base + 1], gz = geysers[base + 2];
        const eruption = geysers[base + 3], maxHeight = geysers[base + 4];
        const dx = px - gx, dz = pz - gz;
        if (dx * dx + dz * dz >= radiusSq) continue;
        const activeHeight = maxHeight * eruption;
        if (py < gy + baseHeight - 0.5 || py > gy + activeHeight + 1.0) continue;
        if (eruption <= 0.1) continue;
        const targetVel = 15.0 * eruption;
        if (vy < targetVel) vy += (targetVel - vy) * 5.0 * delta;
        hit = true;
    }
    return { hit, vy, airJump: hit, unground: hit };
}

function padForcesJS(px, py, pz, pvy, pads, count) {
    for (let i = 0; i < count; i++) {
        const base = i * PAD_STRIDE;
        const padX = pads[base], padY = pads[base + 1], padZ = pads[base + 2];
        const scaleX = pads[base + 3], scaleY = pads[base + 4], currentBob = pads[base + 5];
        const dx = px - padX, dz = pz - padZ;
        const radius = 1.5 * scaleX;
        if (dx * dx + dz * dz >= radius * radius) continue;
        const topY = padY + 0.1 * scaleY;
        if (pvy > 0 || py < topY - 0.2 || py > topY + 0.5) continue;
        if (currentBob > 0.5) return { hit: true, action: 'launch', vy: 20.0, snapY: py, padIndex: i };
        return { hit: true, action: 'snap', vy: 0, snapY: topY, padIndex: i };
    }
    return { hit: false, action: 'none', vy: pvy, snapY: py, padIndex: -1 };
}

function vineProximityJS(px, py, pz, vines, count) {
    let bestIndex = -1, bestDistHSq = Infinity, inAttachZone = false;
    for (let i = 0; i < count; i++) {
        const base = i * VINE_STRIDE;
        const ax = vines[base], ay = vines[base + 1], az = vines[base + 2], length = vines[base + 3];
        const dx = px - ax, dz = pz - az;
        const distHSq = dx * dx + dz * dz;
        const tipY = ay - length;
        if (distHSq >= 4.0 || py >= ay || py <= tipY) continue;
        if (distHSq < bestDistHSq) {
            bestDistHSq = distHSq;
            bestIndex = i;
            inAttachZone = distHSq < 1.0;
        }
    }
    return { candidateIndex: bestIndex, distHSq: bestDistHSq, inAttachZone };
}

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

test('geyser: no hit when far away', () => {
    const geysers = new Float32Array(GEYSER_STRIDE);
    geysers[3] = 1.0; geysers[4] = 5.0;
    const r = geyserLaunchJS(10, 1, 10, 0, 0.016, geysers, 1);
    assert(!r.hit, 'miss when dist > 1.5');
});

test('geyser: lift when in plume', () => {
    const geysers = new Float32Array(GEYSER_STRIDE);
    geysers[3] = 1.0; geysers[4] = 5.0;
    const r = geyserLaunchJS(0, 1.0, 0, 0, 0.1, geysers, 1);
    assert(r.hit && r.vy > 0, 'lift in plume');
});

test('pad: snap when bob low', () => {
    const pads = new Float32Array(PAD_STRIDE);
    pads[1] = 2; pads[3] = 1; pads[4] = 1; pads[5] = 0.2;
    const topY = 2.1;
    const r = padForcesJS(0, topY, 0, -1, pads, 1);
    assert(r.hit && r.action === 'snap', 'snap');
});

test('pad: launch when bob high', () => {
    const pads = new Float32Array(PAD_STRIDE);
    pads[1] = 2; pads[3] = 1; pads[4] = 1; pads[5] = 0.8;
    const r = padForcesJS(0, 2.1, 0, 0, pads, 1);
    assert(r.hit && r.action === 'launch' && r.vy === 20, 'launch');
});

test('vine: attach zone', () => {
    const vines = new Float32Array(VINE_STRIDE);
    vines[1] = 10; vines[3] = 5;
    const r = vineProximityJS(0.5, 8, 0.2, vines, 1);
    assert(r.inAttachZone && r.candidateIndex === 0, 'attach zone');
});

console.log(`\n---\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
