/**
 * Systems performance-budget tests.
 *
 * Headless and GPU-free by design: this asserts that caps are *enforced*
 * (rejected work, clamped counts) and that every budgeted system has a
 * profiler mark and a telemetry row. It deliberately asserts nothing about
 * frame time — CI runs on SwiftShader, where 60 fps is not a meaningful
 * target; the ms budgets in docs/PERF_BUDGETS.md are authoritative on real
 * GPUs only.
 *
 * Run with: npx tsx tests/systems-budget.test.ts
 */

import {
    SYSTEM_BUDGETS,
    __resetSystemBudgetsForTests,
    collectSystemsBudget,
    enforceCap,
    getBudgetCapViolations,
    getCap,
    recordCapRejection,
    registerSystemTelemetry,
    withinCap,
    type SystemBudgetId,
} from '../src/systems/performance-budget/systems-budget.ts';
import { MAX_DYNAMIC_BODIES } from '../src/systems/physics/rigid-body-types.ts';
import { profiler } from '../src/utils/profiler.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
    if (cond) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

// Cap warnings are the point of several tests; keep the output readable.
const realWarn = console.warn;
console.warn = () => {};

// ---------------------------------------------------------------------------
console.log('\nBudget table');
// ---------------------------------------------------------------------------

const ids = Object.keys(SYSTEM_BUDGETS) as SystemBudgetId[];
check('every Feature Completeness system has a budget', ids.length === 7, ids.join(','));

for (const id of ids) {
    const b = SYSTEM_BUDGETS[id];
    check(
        `${id} declares frame/VRAM/caps`,
        b.frameMs > 0 && b.vramMb >= 0 && Object.keys(b.caps).length > 0,
        JSON.stringify(b)
    );
}

const totalFrameMs = ids.reduce((sum, id) => sum + SYSTEM_BUDGETS[id].frameMs, 0);
check(
    'system budgets leave headroom inside a 16.67ms frame',
    totalFrameMs < 16.67,
    `${totalFrameMs.toFixed(2)}ms allocated`
);

check(
    'rigid-body cap is the WASM pool size, not a copy',
    SYSTEM_BUDGETS.rigidBodies.caps.bodies === MAX_DYNAMIC_BODIES,
    `${SYSTEM_BUDGETS.rigidBodies.caps.bodies} vs ${MAX_DYNAMIC_BODIES}`
);

// ---------------------------------------------------------------------------
console.log('\nCap enforcement');
// ---------------------------------------------------------------------------

__resetSystemBudgetsForTests();

check('a request inside the cap passes through', enforceCap('particles', 'emitters', 4) === 4);
check(
    'a request over the cap is clamped to the limit',
    enforceCap('particles', 'emitters', 999) === getCap('particles', 'emitters'),
    'excess must be rejected, not queued'
);
check('withinCap reports the rejection', withinCap('rigidBodies', 'bodies', 1000) === false);
check('withinCap accepts a fitting request', withinCap('rigidBodies', 'bodies', 1) === true);
check('an unknown cap is unbounded', enforceCap('particles', 'nope', 1e9) === 1e9);

const violations = getBudgetCapViolations();
check('violations are recorded once per cap', violations.length === 2, JSON.stringify(violations));

const emitterViolation = violations.find((v) => v.cap === 'emitters');
check(
    'a violation carries limit, peak and hit count',
    emitterViolation?.limit === getCap('particles', 'emitters') &&
        emitterViolation?.peakRequested === 999 &&
        emitterViolation?.hits === 1,
    JSON.stringify(emitterViolation)
);

enforceCap('particles', 'emitters', 5000);
check(
    'repeat overflows accumulate without a second warning entry',
    getBudgetCapViolations().length === 2 &&
        getBudgetCapViolations().find((v) => v.cap === 'emitters')?.hits === 2
);

__resetSystemBudgetsForTests();
recordCapRejection('shadows', 'localShadowLights', 2, 1);
const tighter = getBudgetCapViolations()[0];
check(
    'a subsystem may report its own tighter limit',
    tighter?.limit === 1 && tighter.peakRequested === 2,
    JSON.stringify(tighter)
);

// ---------------------------------------------------------------------------
console.log('\nTelemetry rows');
// ---------------------------------------------------------------------------

__resetSystemBudgetsForTests();

const unregistered = collectSystemsBudget();
check('every system gets a row even with no provider', unregistered.length === ids.length);
check(
    'an unregistered system reports null telemetry rather than throwing',
    unregistered.every((r) => r.telemetry === null)
);

registerSystemTelemetry('particles', () => ({
    enabled: true,
    counts: { totalParticles: SYSTEM_BUDGETS.particles.caps.totalParticles, emitters: 2 },
    frameMs: 99,
}));
registerSystemTelemetry('gi', () => {
    throw new Error('provider blew up');
});

const rows = collectSystemsBudget();
const particles = rows.find((r) => r.system === 'particles');
check('a count at its cap is flagged', particles?.overCaps.includes('totalParticles') === true);
check('a count under its cap is not flagged', particles?.overCaps.includes('emitters') === false);
check('a frame cost over budget is flagged', particles?.overFrameMs === true);

const gi = rows.find((r) => r.system === 'gi');
check(
    'a throwing provider degrades to a reason, not a crash',
    gi?.telemetry?.enabled === false && gi.telemetry.reason === 'telemetry error'
);

// ---------------------------------------------------------------------------
console.log('\nProfiler marks (existence only — no GPU timing in CI)');
// ---------------------------------------------------------------------------

check('marks are recorded while the overlay is off', (() => {
    profiler.enabled = false;
    profiler.mark('particles.update', 1.25);
    return profiler.getMark('particles.update') === 1.25;
})());

profiler.mark('rigidBodies.step', 0.4);
check(
    'marks accumulate in the mark table',
    profiler.getMarks().size >= 2,
    `${profiler.getMarks().size} marks`
);

console.warn = realWarn;
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
