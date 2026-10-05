// tests/sky-wave-ring.test.mjs
// WaveRing: overlapping sky waves keep their own timestamp/color and never allocate.
// Imports music-wave.ts directly — music-reactivity.ts can't load under Node (uTwilight import cycle).
import * as THREE from 'three';
import { WaveRing, WAVE_SLOT_COUNT } from '../src/systems/music-wave.ts';

let failed = 0;
function assert(cond, msg) {
    console.log(`${cond ? '✅ PASS' : '❌ FAIL'}: ${msg}`);
    if (!cond) failed++;
}

const red = new THREE.Color(1, 0, 0);
const green = new THREE.Color(0, 1, 0);
const PROP_MS = 800;

// 150 BPM = a beat every 400 ms: three waves overlap inside one 800 ms window.
{
    const ring = new WaveRing();
    const a = ring.push(red, 0);
    const b = ring.push(green, 400);
    assert(a !== b, 'consecutive beats claim distinct slots');
    assert(a.timestamp === 0 && b.timestamp === 400, 'second beat does not restart the first wave');
    assert(a.color.equals(red) && b.color.equals(green), 'each slot keeps its own color');
    assert(ring.expire(500, PROP_MS), 'waves in flight → expire() reports active');
    assert(ring.newestActive() === b, 'newest active slot is the latest beat');
}

{
    const ring = new WaveRing();
    const a = ring.push(red, 0);
    ring.push(green, 400);
    assert(
        ring.expire(850, PROP_MS) && !a.active,
        'oldest wave expires at its own 800 ms, newest keeps going'
    );
    assert(!ring.expire(1300, PROP_MS), 'all waves expired → not active');
    assert(ring.newestActive() === null, 'newestActive() is null once expired');
}

// Slots are reused after wrap-around, and the color object identity never changes (zero alloc).
{
    const ring = new WaveRing();
    const colors = ring.slots.map((s) => s.color);
    for (let i = 0; i < WAVE_SLOT_COUNT * 3; i++) ring.push(i % 2 ? red : green, i * 100);
    assert(
        ring.slots.every((s, i) => s.color === colors[i]),
        'slot Color objects are reused, not reallocated'
    );
    assert(ring.slots.length === WAVE_SLOT_COUNT, 'ring size stays fixed');
    // head points at the oldest slot: iterating from head visits oldest→newest.
    const order = [];
    for (let k = 0; k < WAVE_SLOT_COUNT; k++)
        order.push(ring.slots[(ring.head + k) % WAVE_SLOT_COUNT].timestamp);
    assert(
        order.every((t, i) => i === 0 || order[i - 1] < t),
        'iteration from head is oldest→newest'
    );
}

{
    const ring = new WaveRing();
    ring.push(red, 0);
    ring.clear();
    assert(
        ring.newestActive() === null && !ring.expire(1, PROP_MS),
        'clear() deactivates every slot (dawn guard)'
    );
}

console.log(failed ? `\n${failed} failed` : '\nAll sky-wave ring tests passed');
process.exit(failed ? 1 : 0);
