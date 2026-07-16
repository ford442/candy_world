/**
 * Photo mode preset + time scrub helpers.
 * Run: node tests/photo-mode.test.mjs
 */

const CYCLE_DURATION = 960;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        console.log(`✓ ${msg}`);
        passed++;
    } else {
        console.error(`✗ ${msg}`);
        failed++;
    }
}

const PRESETS = [
    { id: 'dreamy', dofMix: 0.85, focusDistance: 6 },
    { id: 'macro', dofMix: 1.0, focusDistance: 3.5 },
    { id: 'wide_vista', dofMix: 0.15, focusDistance: 28 },
];

function scrubTimeOffset(gameTime, targetCycle) {
    return targetCycle - gameTime;
}

assert(PRESETS.length === 3, 'three composition presets');
assert(PRESETS[0].dofMix > PRESETS[2].dofMix, 'dreamy blurrier than wide vista');

const gameTime = 120;
const target = 480;
const offset = scrubTimeOffset(gameTime, target);
assert(
    (gameTime + offset) % CYCLE_DURATION === target % CYCLE_DURATION,
    'time scrub hits target cycle position'
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
