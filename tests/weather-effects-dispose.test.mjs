/**
 * Teardown tests for EffectsManager (weather visual effects).
 * Imports the production implementation; no renderer or browser boot required.
 *
 * Deliberately does not assert renderer.info.memory: with three r171 under Node the
 * counters only move after a render, so they would prove nothing here.
 *
 * Run: npm run test:weather-dispose
 */

import * as THREE from 'three';
import { EffectsManager } from '../src/systems/weather/weather-effects.ts';

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

function spyDispose(target) {
    const spy = { calls: 0 };
    const original = target.dispose.bind(target);
    target.dispose = () => {
        spy.calls++;
        original();
    };
    return spy;
}

// One manager only: the lightning light holds a fixed-id point-pool slot.
const scene = new THREE.Group();
const effects = new EffectsManager(scene);
const state = effects.getState();

console.log('initAurora() is idempotent');
effects.initAurora();
const firstAurora = state.aurora;
assert(firstAurora && scene.children.includes(firstAurora), 'first aurora added to scene');
const firstGeo = spyDispose(firstAurora.geometry);
const firstMat = spyDispose(firstAurora.material);

effects.initAurora();
const secondAurora = state.aurora;
assert(secondAurora && secondAurora !== firstAurora, 're-init builds a new aurora');
assert(firstGeo.calls === 1, 'first aurora geometry disposed on re-init');
assert(firstMat.calls === 1, 'first aurora material disposed on re-init');
assert(!scene.children.includes(firstAurora), 'first aurora removed from scene');
assert(scene.children.includes(secondAurora), 'second aurora in scene');

console.log('initRainbow() is idempotent');
effects.initRainbow();
const firstRainbow = state.rainbow;
effects.initRainbow();
assert(state.rainbow !== firstRainbow, 're-init builds a new rainbow');
assert(!scene.children.includes(firstRainbow), 'first rainbow removed from scene');
assert(scene.children.includes(state.rainbow), 'second rainbow in scene');

console.log('dispose() releases the aurora');
const geo = spyDispose(secondAurora.geometry);
const mat = spyDispose(secondAurora.material);
const rainbow = state.rainbow;
effects.dispose();
assert(geo.calls === 1, 'aurora geometry disposed');
assert(mat.calls === 1, 'aurora material disposed');
assert(!scene.children.includes(secondAurora), 'aurora removed from scene');
assert(state.aurora === null, 'state.aurora nulled');
assert(!scene.children.includes(rainbow), 'rainbow removed from scene');
assert(state.rainbow === null, 'state.rainbow nulled');

console.log('dispose() is safe to call twice');
let threw = null;
try {
    effects.dispose();
} catch (e) {
    threw = e;
}
assert(threw === null, `second dispose() does not throw${threw ? `: ${threw}` : ''}`);
assert(geo.calls === 1 && mat.calls === 1, 'second dispose() does not re-dispose the aurora');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
