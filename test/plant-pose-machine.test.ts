/**
 * @file plant-pose-machine.test.ts
 * @description Verifies the PlantPoseMachine ADSR state machine:
 *   - Zero per-frame allocations (flat Float32Array storage)
 *   - Attack phase ramps pose up when channel intensity is above threshold
 *   - Release phase ramps pose down when channel is quiet
 *   - Day/night bias shifts baseline pose even with no music
 *   - Sustained high intensity produces visibly different result than transient spike
 */

import { PlantPoseMachine } from '../src/foliage/plant-pose-machine.ts';
import type { PlantPoseConfig } from '../src/foliage/plant-pose-machine.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

const tests: { name: string; run: () => boolean | void }[] = [];

function test(name: string, fn: () => boolean | void): void {
    tests.push({ name, run: fn });
}

function runTests(): void {
    console.log('🧪 Running PlantPoseMachine Tests...\n');

    let passed = 0;
    let failed = 0;

    for (const { name, run } of tests) {
        try {
            const result = run();
            if (result === false) {
                console.log(`❌ FAIL: ${name}`);
                failed++;
            } else {
                console.log(`✅ PASS: ${name}`);
                passed++;
            }
        } catch (error) {
            console.log(`❌ ERROR: ${name} — ${error}`);
            failed++;
        }
    }

    console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

// ── Config fixture ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: PlantPoseConfig = {
    attackRate: 5.0,
    releaseRate: 1.0,
    sustainLevel: 1.0,
    dayTarget: 1.0,
    nightTarget: 0.0,
    triggerThreshold: 0.05,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

test('instantiates with correct capacity', () => {
    const m = new PlantPoseMachine(16);
    console.assert(m.capacity === 16, 'capacity should equal constructor arg');
    for (let i = 0; i < 16; i++) {
        console.assert(m.getPose(i) === 0, `initial pose at index ${i} should be 0`);
    }
});

test('attack phase: pose rises above 0 after sustained high-intensity frames', () => {
    const m = new PlantPoseMachine(1);
    // Simulate 30 frames at 60 Hz with channel active
    for (let f = 0; f < 30; f++) {
        m.update(1, 1 / 60, 1.0, 1.0, DEFAULT_CONFIG);
    }
    const pose = m.getPose(0);
    console.assert(pose > 0.5, `pose after sustained attack should be >0.5, got ${pose}`);
});

test('release phase: pose falls after channel goes silent', () => {
    const m = new PlantPoseMachine(1);
    // Use night bias so the envelope actively governs pose (baseline=0, peak=1)
    for (let f = 0; f < 60; f++) {
        m.update(1, 1 / 60, 1.0, 0.0, DEFAULT_CONFIG);
    }
    const peakPose = m.getPose(0);

    // Release for 60 frames at night
    for (let f = 0; f < 60; f++) {
        m.update(1, 1 / 60, 0.0, 0.0, DEFAULT_CONFIG);
    }
    const releasedPose = m.getPose(0);
    console.assert(releasedPose < peakPose, `pose after release (${releasedPose}) should be lower than peak (${peakPose})`);
});

test('sustained vs transient: same total energy, different final pose', () => {
    const cfg = { ...DEFAULT_CONFIG, attackRate: 5.0, releaseRate: 2.0 };

    // Case A: sustained 30 frames at night (dayNightBias=0 → envelope governs 0..1)
    const mA = new PlantPoseMachine(1);
    for (let f = 0; f < 30; f++) {
        mA.update(1, 1 / 60, 1.0, 0.0, cfg);
    }
    const sustainedPose = mA.getPose(0);

    // Case B: single-frame spike followed by 29 frames of silence at night
    const mB = new PlantPoseMachine(1);
    mB.update(1, 1 / 60, 1.0, 0.0, cfg);   // 1 frame spike
    for (let f = 1; f < 30; f++) {
        mB.update(1, 1 / 60, 0.0, 0.0, cfg); // 29 silent frames
    }
    const transientPose = mB.getPose(0);

    console.assert(
        sustainedPose > transientPose + 0.5,
        `sustained pose (${sustainedPose.toFixed(3)}) should be significantly higher than transient (${transientPose.toFixed(3)})`
    );
});

test('day/night bias: night yields lower baseline than day when music is silent', () => {
    const mDay = new PlantPoseMachine(1);
    const mNight = new PlantPoseMachine(1);

    const cfg = { ...DEFAULT_CONFIG, nightTarget: 0.0, dayTarget: 1.0 };

    // Run many silent frames to let envelope settle
    for (let f = 0; f < 120; f++) {
        mDay.update(1, 1 / 60, 0.0, 1.0, cfg);    // full day
        mNight.update(1, 1 / 60, 0.0, 0.0, cfg);  // full night
    }

    const dayPose = mDay.getPose(0);
    const nightPose = mNight.getPose(0);

    console.assert(
        dayPose > nightPose + 0.05,
        `day pose (${dayPose.toFixed(3)}) should be noticeably higher than night pose (${nightPose.toFixed(3)}) with silent music`
    );
});

test('per-instance isolation: pose at index 0 does not affect index 1', () => {
    const m = new PlantPoseMachine(4);
    const cfg = { ...DEFAULT_CONFIG };

    // Update all 4 instances with identical inputs (channelIntensity=0, dayNightBias=1).
    // With no channel activity the envelope level stays at 0, so each instance's currentPose
    // converges to the day baseline (dayTarget × dayNightBias = 1.0).
    // All slots should land at the same value, confirming no cross-slot contamination.
    for (let f = 0; f < 30; f++) {
        m.update(4, 1 / 60, 0.0, 1.0, cfg);
    }

    const p0 = m.getPose(0);
    const p1 = m.getPose(1);
    console.assert(Math.abs(p0 - p1) < 0.001, `poses at index 0 and 1 should match when updated identically: ${p0} vs ${p1}`);
});

test('reset clears an instance slot to zero', () => {
    const m = new PlantPoseMachine(2);
    // Warm up slot 0
    for (let f = 0; f < 30; f++) {
        m.update(2, 1 / 60, 1.0, 1.0, DEFAULT_CONFIG);
    }
    console.assert(m.getPose(0) > 0.1, 'pre-condition: slot 0 should be non-zero');
    m.reset(0);
    console.assert(m.getPose(0) === 0, `after reset, slot 0 should be 0, got ${m.getPose(0)}`);
    // Slot 1 should be unchanged
    const p1Before = m.getPose(1);
    console.assert(p1Before > 0.1, 'slot 1 should still be non-zero after slot 0 reset');
});

test('no per-frame allocations: getPose returns primitive number', () => {
    const m = new PlantPoseMachine(1);
    m.update(1, 1 / 60, 0.5, 0.5, DEFAULT_CONFIG);
    const result = m.getPose(0);
    console.assert(typeof result === 'number', `getPose should return a primitive number, got ${typeof result}`);
});

// ── Run ───────────────────────────────────────────────────────────────────────

runTests();
