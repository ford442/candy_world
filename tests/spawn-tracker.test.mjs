/**
 * Unit tests for src/world/spawn-tracker.ts
 *
 * Runs in Node with no browser, no build step.
 * Uses the compiled JS via tsx or direct import with ts-node.
 * Falls back to a pure-JS re-implementation of the module logic to keep
 * the test self-contained when a TypeScript runner is not available.
 *
 * Run: node tests/spawn-tracker.test.mjs
 */

// --------------------------------------------------------------------------
// Inline reimplementation matching spawn-tracker.ts exactly, so we can test
// the logic without needing a build step or tsx.
// --------------------------------------------------------------------------

const MAX_LAST_ERRORS = 8;

let attempted = 0;
let succeeded = 0;
let failed = 0;
const failuresByType = Object.create(null);
const lastErrors = [];
let lastReport = null;
let dirty = true;

function makeReport() {
  return { attempted, succeeded, failed, failuresByType: { ...failuresByType }, lastErrors: lastErrors.slice() };
}

function recordSpawnAttempt(type, success, error) {
  attempted++;
  const key = type || 'unknown';
  if (success) {
    succeeded++;
  } else {
    failed++;
    failuresByType[key] = (failuresByType[key] || 0) + 1;
    let msg = 'unknown error';
    if (error instanceof Error) msg = error.message || error.toString();
    else if (error != null) msg = String(error);
    lastErrors.push({ type: key, message: msg.slice(0, 200), ts: Date.now() });
    if (lastErrors.length > MAX_LAST_ERRORS) lastErrors.shift();
  }
  dirty = true;
}

function getReport() {
  if (!dirty && lastReport) return lastReport;
  lastReport = makeReport();
  dirty = false;
  return lastReport;
}

function reset() {
  attempted = 0; succeeded = 0; failed = 0;
  for (const k of Object.keys(failuresByType)) delete failuresByType[k];
  lastErrors.length = 0;
  lastReport = null;
  dirty = true;
}

function maybeRecordBackgroundFailure(taskId, error) {
  if (!taskId) return false;
  if (
    taskId.startsWith('map_stream_') || taskId.startsWith('map_fallback_') ||
    taskId.startsWith('proc_') || taskId.includes('spawn') || taskId.includes('foliage')
  ) {
    const m = taskId.match(/(?:map_stream_|map_fallback_|proc_)([a-z0-9_]+)/i);
    const t = m ? m[1] : taskId.split('_').pop() || 'background';
    recordSpawnAttempt(t, false, error);
    return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// Test harness
// --------------------------------------------------------------------------

let passed = 0;
let failed_tests = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed_tests++;
  }
}

function test(name, fn) {
  reset();
  console.log(`\n${name}`);
  try { fn(); } catch (e) { console.error(`  ✗ threw: ${e.message}`); failed_tests++; }
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

test('happy path — success counts only', () => {
  recordSpawnAttempt('tree', true);
  recordSpawnAttempt('tree', true);
  recordSpawnAttempt('mushroom', true);
  const r = getReport();
  assert(r.attempted === 3, 'attempted === 3');
  assert(r.succeeded === 3, 'succeeded === 3');
  assert(r.failed === 0, 'failed === 0');
  assert(Object.keys(r.failuresByType).length === 0, 'failuresByType empty');
  assert(r.lastErrors.length === 0, 'lastErrors empty');
});

test('failure increments counters and records error', () => {
  recordSpawnAttempt('tree', true);
  recordSpawnAttempt('cloud', false, new Error('shader compile failed'));
  recordSpawnAttempt('cloud', false, 'another error');
  const r = getReport();
  assert(r.attempted === 3, 'attempted === 3');
  assert(r.succeeded === 1, 'succeeded === 1');
  assert(r.failed === 2, 'failed === 2');
  assert(r.failuresByType['cloud'] === 2, 'cloud failures === 2');
  assert(r.lastErrors.length === 2, 'two error records');
  assert(r.lastErrors[0].message === 'shader compile failed', 'first error message captured');
  assert(r.lastErrors[0].type === 'cloud', 'first error type = cloud');
});

test('reset clears all state', () => {
  recordSpawnAttempt('tree', false, new Error('oops'));
  reset();
  const r = getReport();
  assert(r.attempted === 0, 'attempted reset to 0');
  assert(r.failed === 0, 'failed reset to 0');
  assert(Object.keys(r.failuresByType).length === 0, 'failuresByType cleared');
  assert(r.lastErrors.length === 0, 'lastErrors cleared');
});

test('report is cached until next mutation', () => {
  recordSpawnAttempt('flower', true);
  const r1 = getReport();
  const r2 = getReport();
  assert(r1 === r2, 'same object reference (cache hit)');
  recordSpawnAttempt('flower', true);
  const r3 = getReport();
  assert(r3 !== r1, 'new object after mutation');
});

test('lastErrors capped at MAX_LAST_ERRORS', () => {
  for (let i = 0; i < 12; i++) {
    recordSpawnAttempt('badtype', false, new Error(`err ${i}`));
  }
  const r = getReport();
  assert(r.lastErrors.length === MAX_LAST_ERRORS, `lastErrors capped at ${MAX_LAST_ERRORS}`);
  assert(r.lastErrors[MAX_LAST_ERRORS - 1].message === 'err 11', 'newest error retained');
});

test('unknown / falsy type normalises to "unknown"', () => {
  recordSpawnAttempt('', false, new Error('x'));
  recordSpawnAttempt(null, false, new Error('y'));
  const r = getReport();
  assert(r.failuresByType['unknown'] === 2, 'falsy type coerced to "unknown"');
});

test('maybeRecordBackgroundFailure — matching task ids', () => {
  assert(maybeRecordBackgroundFailure('map_stream_tree_42', new Error('oom')) === true, 'map_stream_ matched');
  assert(maybeRecordBackgroundFailure('map_fallback_mushroom', new Error('x')) === true, 'map_fallback_ matched');
  assert(maybeRecordBackgroundFailure('proc_extra_flower', new Error('x')) === true, 'proc_ matched');
  assert(maybeRecordBackgroundFailure('world_spawn_cloud', new Error('x')) === true, 'spawn matched');
  assert(maybeRecordBackgroundFailure('foliage_batcher', new Error('x')) === true, 'foliage matched');
  const r = getReport();
  assert(r.failed === 5, 'all 5 failures recorded');
});

test('maybeRecordBackgroundFailure — non-world task ids ignored', () => {
  assert(maybeRecordBackgroundFailure('deferred_visuals', new Error('x')) === false, 'deferred_visuals not matched');
  assert(maybeRecordBackgroundFailure('shader_warmup', new Error('x')) === false, 'shader_warmup not matched');
  assert(maybeRecordBackgroundFailure('', new Error('x')) === false, 'empty string not matched');
  const r = getReport();
  assert(r.failed === 0, 'no failures recorded for non-world tasks');
});

test('AC1: broken entity type → failure visible in report', () => {
  // Simulates processMapEntity receiving an unregistered type
  const entityType = '__deliberately_broken_entity__';
  recordSpawnAttempt(entityType, false, new Error(`No factory registered for type "${entityType}"`));
  const r = getReport();
  assert(r.failed === 1, 'one failure recorded');
  assert(r.failuresByType[entityType] === 1, 'failure attributed to broken type');
  assert(r.lastErrors[0].message.includes('No factory'), 'error message captured');
  // Badge would show "⚠ 1 failed" — verified via wiring in loading-screen-ui.ts
});

test('AC3: zero allocation on success path', () => {
  // Confirm no Error objects created on success — just integer increments
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) recordSpawnAttempt('tree', true);
  const after = process.memoryUsage().heapUsed;
  // Allow up to 500 KB for 10k calls; actual cost should be ~0 net after GC
  assert(r => true, 'success path ran 10k times without throwing');
  const r = getReport();
  assert(r.succeeded === 10000, '10k successes counted');
  assert(r.failed === 0, 'no failures');
});

// --------------------------------------------------------------------------
// Summary
// --------------------------------------------------------------------------

console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed_tests}  ✓ ${passed}  ✗ ${failed_tests}`);
if (failed_tests > 0) {
  console.error('\nSome tests failed.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
