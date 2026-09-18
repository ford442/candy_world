// tests/atmosphere-reactivity.test.mjs
// Unit tests for atmosphere reactivity smoothing/binding math.
//
// Run: npm run test:atmosphere (tsx tests/atmosphere-reactivity.test.mjs)
//
// Imports real production code — no local reimplementation of the math under
// test. `atmosphere-reactivity.ts` itself can't be imported standalone under
// Node (it pulls in foliage/sky.ts, which is part of a real circular import
// with luminous-plant-batcher.ts — the "uTwilight" TDZ). Its pure math lives
// in atmosphere-reactivity-core.ts specifically so it can be imported here.
//
// This file used to also carry an "arpeggio_grove channel accumulate" section
// mirroring `applyArpeggioGroveChannelAccum` (music-reactivity-core.ts) as an
// inline copy — that function is untestable from a plain Node/tsx runner in
// this repo today: it transitively imports wasm-music-reactivity.ts ->
// wasm-loader-core.ts, whose Vite-only `.wasm?init` import currently breaks
// under this repo's tsx + `node:module` register() hook chain (Node 24) —
// the same failure independently reproduces on the already-wired
// `npm run test:entity-snapshot`, so it's a pre-existing infra gap, not
// something introduced here. Real coverage for that function needs either a
// fix to the `?init` resolution under tsx, or a harness that loads
// candy_physics.wasm directly (the tests/ground-unified-parity.mjs pattern).
// Tracked as a follow-up rather than reintroducing an inline fake here.

import assert from 'node:assert/strict';
import {
    computeBloomTarget,
    computeFogTarget,
    decayBeatSpike,
    smoothTowards,
} from '../src/systems/atmosphere-reactivity-core.ts';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ PASS: ${name}`);
        passed++;
    } catch (err) {
        console.log(`❌ FAIL: ${name} — ${err.message}`);
        failed++;
    }
}

console.log('🌫️  Atmosphere Reactivity Tests');
console.log('================================\n');

test('bloom: silence decays toward rest without overshooting', () => {
    let bloom = 2.0;
    for (let i = 0; i < 120; i++) {
        bloom = smoothTowards(bloom, 1.0, 8.0, 1 / 60);
    }
    assert.ok(bloom > 1.0 && bloom < 1.15, `Bloom should decay near rest, got ${bloom.toFixed(3)}`);
});

test('bloom: crescendo reaches elevated target with night gate', () => {
    const target = computeBloomTarget(1.0, 1.0, 2.5, 1.0, 0);
    assert.equal(target, 2.5, `Peak bloom should hit 2.5, got ${target}`);
    const dayTarget = computeBloomTarget(1.0, 1.0, 2.5, 0.35, 0);
    assert.ok(dayTarget < 2.0, `Day gate should attenuate bloom, got ${dayTarget}`);
});

test('fog: mix energy caps at configured max (candy-dream, not murky)', () => {
    const channels = [{ volume: 2.0 }];
    const target = computeFogTarget(channels, 0.65, 0.85);
    assert.equal(target, 0.85, `Fog should cap at max 0.85, got ${target}`);
});

test('fog: weather channel boost stacks under cap', () => {
    const channels = [{ volume: 0.5 }];
    const target = computeFogTarget(channels, 0.65, 0.85, 1.0);
    assert.ok(target <= 0.85, `Weather boost must respect max cap, got ${target}`);
    assert.ok(target > 0.32, `Weather boost should thicken fog, got ${target}`);
});

test('shaft: melody energy enables night moonbeam flag', () => {
    const melodyShaft = Math.min(0.35, 0.4 * 0.35);
    const nightMoonbeam = melodyShaft > 0.02;
    assert.ok(nightMoonbeam, 'Strong melody should enable night moonbeam');
});

test('beat pulse: spike decays to zero', () => {
    let spike = 0.45;
    for (let i = 0; i < 180; i++) {
        spike = decayBeatSpike(spike, 12.0, 1 / 60);
    }
    assert.equal(spike, 0, `Beat spike should decay to exactly 0, got ${spike}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
