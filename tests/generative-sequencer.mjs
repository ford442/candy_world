/**
 * Determinism tests for generative sequencer (pure JS — no TS compile needed).
 * Run: node tests/generative-sequencer.mjs
 */

class SeededRng {
    constructor(seed) {
        this.state = seed >>> 0 || 0x6d2b79f5;
    }
    next() {
        let t = (this.state += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(min, max) {
        return min + Math.floor(this.next() * (max - min + 1));
    }
}

const STEPS_PER_BAR = 16;
const NUM_CHANNELS = 8;

function generatePattern(seed, ch, density) {
    const rng = new SeededRng(seed + ch * 7919);
    const pattern = new Array(STEPS_PER_BAR).fill(false);
    for (let s = 0; s < STEPS_PER_BAR; s++) {
        let prob = density * 0.45;
        if (ch === 0) prob = s % 4 === 0 ? 0.95 : 0.05;
        pattern[s] = rng.next() < prob;
    }
    return pattern;
}

function simulateTicks(seed, ticks) {
    const patterns = [];
    for (let ch = 0; ch < NUM_CHANNELS; ch++) {
        patterns[ch] = generatePattern(seed, ch, 0.7);
    }
    const events = [];
    let step = 0;
    for (let t = 0; t < ticks; t++) {
        for (let ch = 0; ch < NUM_CHANNELS; ch++) {
            if (patterns[ch][step]) events.push(`${ch}:${step}`);
        }
        step = (step + 1) % STEPS_PER_BAR;
    }
    return events.join('|');
}

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

const runA = simulateTicks(42, 64);
const runB = simulateTicks(42, 64);
const runC = simulateTicks(99, 64);

assert(runA === runB, 'identical seeds produce identical event streams');
assert(runA !== runC, 'different seeds diverge');
assert(runA.length > 0, 'produces events');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
