/**
 * Unit tests for src/world/world-health.ts logic.
 *
 * Inlines the validation logic so no build step or browser is needed.
 * Run: node tests/world-health.test.mjs
 */

// ---- inline stubs matching the real module shapes ----

const FULL_MODE_MINIMUMS = { animatedFoliage: 50, mushrooms: 5, clouds: 3 };
const FAILURE_RATE_THRESHOLD = 0.05;

function validate(spawnReport, sceneObjects, batcherTotal, mode = 'FULL') {
    const warnings = [];

    if (spawnReport.failed > 0) {
        const rate = spawnReport.attempted > 0 ? spawnReport.failed / spawnReport.attempted : 0;
        warnings.push(
            `${spawnReport.failed} spawn failure(s) (${(rate * 100).toFixed(1)}% of ${spawnReport.attempted} attempted). Types: ${Object.entries(spawnReport.failuresByType).map(([k, v]) => `${k}:${v}`).join(', ')}`
        );
    }

    if (mode === 'FULL' || mode === 'FAST_FULL') {
        for (const [key, min] of Object.entries(FULL_MODE_MINIMUMS)) {
            const actual = sceneObjects[key] ?? 0;
            if (actual < min) warnings.push(`Expected ≥${min} ${key}, found ${actual}.`);
        }
    }

    const failureRate = spawnReport.attempted > 0 ? spawnReport.failed / spawnReport.attempted : 0;
    if (spawnReport.attempted > 10 && failureRate > FAILURE_RATE_THRESHOLD) {
        warnings.push(`Spawn failure rate ${(failureRate * 100).toFixed(1)}% exceeds ${FAILURE_RATE_THRESHOLD * 100}% threshold.`);
    }

    return {
        mode, ts: Date.now(),
        ...spawnReport,
        sceneObjects,
        batchers: { totalInstances: batcherTotal, entries: [] },
        warnings,
        healthy: warnings.length === 0,
    };
}

// ---- test harness ----

let passed = 0, failed = 0;
function assert(cond, label) {
    if (cond) { console.log(`  ✓ ${label}`); passed++; }
    else       { console.error(`  ✗ ${label}`); failed++; }
}
function test(name, fn) {
    console.log(`\n${name}`);
    try { fn(); } catch (e) { console.error(`  ✗ threw: ${e.message}`); failed++; }
}

// ---- helpers ----

const cleanScene = { animatedFoliage: 200, interactive: 30, mushrooms: 20, clouds: 10,
                      geysers: 2, traps: 1, vineLadders: 0, trampolines: 0, panningPads: 0, portamentoPines: 3 };
const cleanSpawn = { attempted: 250, succeeded: 250, failed: 0, failuresByType: {} };

// ---- tests ----

test('AC1: clean FULL boot → healthy, failed===0', () => {
    const r = validate(cleanSpawn, cleanScene, 400, 'FULL');
    assert(r.healthy, 'healthy === true');
    assert(r.failed === 0, 'failed === 0');
    assert(r.warnings.length === 0, 'no warnings');
    assert(r.sceneObjects.animatedFoliage === 200, 'foliage count propagated');
    assert(r.batchers.totalInstances === 400, 'batcher total propagated');
});

test('AC2: forced bad spawn → report reflects failures', () => {
    const badSpawn = { attempted: 250, succeeded: 245, failed: 5, failuresByType: { '__bad__': 5 } };
    const r = validate(badSpawn, cleanScene, 400, 'FULL');
    assert(!r.healthy, 'not healthy when failures present');
    assert(r.failed === 5, 'failed count correct');
    assert(r.warnings.some(w => w.includes('5 spawn failure')), 'failure warning present');
    assert(r.failuresByType['__bad__'] === 5, 'type breakdown preserved');
});

test('FULL mode under-count triggers warnings', () => {
    const underScene = { ...cleanScene, animatedFoliage: 10, mushrooms: 1, clouds: 0 };
    const r = validate(cleanSpawn, underScene, 0, 'FULL');
    assert(!r.healthy, 'unhealthy on under-count');
    assert(r.warnings.some(w => w.includes('animatedFoliage')), 'animatedFoliage warning');
    assert(r.warnings.some(w => w.includes('mushrooms')), 'mushrooms warning');
    assert(r.warnings.some(w => w.includes('clouds')), 'clouds warning');
});

test('CORE mode skips FULL under-count checks', () => {
    const underScene = { ...cleanScene, animatedFoliage: 5, mushrooms: 0, clouds: 0 };
    const r = validate(cleanSpawn, underScene, 0, 'CORE');
    // CORE mode has no minimum requirements
    assert(r.healthy, 'CORE mode healthy even with low counts');
    assert(r.warnings.length === 0, 'no under-count warnings in CORE mode');
});

test('failure rate threshold triggers extra warning', () => {
    const highFailSpawn = { attempted: 100, succeeded: 88, failed: 12, failuresByType: { tree: 12 } };
    const r = validate(highFailSpawn, cleanScene, 0, 'FULL');
    const rateWarn = r.warnings.filter(w => w.includes('failure rate'));
    assert(rateWarn.length === 1, 'rate warning emitted');
    assert(rateWarn[0].includes('12.0%'), 'rate value correct');
});

test('failure rate below threshold → no rate warning', () => {
    const lowFailSpawn = { attempted: 100, succeeded: 96, failed: 4, failuresByType: { mushroom: 4 } };
    const r = validate(lowFailSpawn, cleanScene, 0, 'FULL');
    assert(!r.warnings.some(w => w.includes('failure rate')), 'no rate warning below threshold');
    // But the count warning IS still there
    assert(r.warnings.some(w => w.includes('4 spawn failure')), 'count warning present');
});

test('small attempted count (≤10) skips rate check', () => {
    const smallSpawn = { attempted: 10, succeeded: 8, failed: 2, failuresByType: { flower: 2 } };
    const r = validate(smallSpawn, cleanScene, 0, 'FULL');
    assert(!r.warnings.some(w => w.includes('failure rate')), 'no rate warning for small sample');
});

test('zero attempted → no divide-by-zero, healthy if scene ok (CORE)', () => {
    const zeroSpawn = { attempted: 0, succeeded: 0, failed: 0, failuresByType: {} };
    const r = validate(zeroSpawn, cleanScene, 0, 'CORE');
    assert(r.healthy, 'healthy with zero attempts in CORE mode');
});

test('report shape includes all required fields', () => {
    const r = validate(cleanSpawn, cleanScene, 123, 'FULL');
    assert(typeof r.ts === 'number', 'ts is number');
    assert(typeof r.mode === 'string', 'mode is string');
    assert(typeof r.healthy === 'boolean', 'healthy is boolean');
    assert(Array.isArray(r.warnings), 'warnings is array');
    assert(typeof r.sceneObjects === 'object', 'sceneObjects present');
    assert(typeof r.batchers === 'object', 'batchers present');
    assert(typeof r.batchers.totalInstances === 'number', 'totalInstances is number');
});

// ---- summary ----
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) { console.error('\nSome tests failed.'); process.exit(1); }
else            { console.log('\nAll tests passed.'); }
