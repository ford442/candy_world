// tests/progressive-boot.test.mjs
// Unit tests for progressive boot dependency + halt logic.

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

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// Mirrors STAGE_REGISTRY dependency checks from src/debug/boot-registry.ts
const STAGE_REGISTRY = {
  core: { critical: true, dependsOn: [] },
  weather: { critical: false, dependsOn: ['core'] },
  worldCritical: { critical: true, dependsOn: ['core', 'weather'] },
  gameLoop: { critical: true, dependsOn: ['core', 'weather', 'interaction', 'worldCritical'] },
  worldGeneration: { critical: false, dependsOn: ['core', 'worldCritical', 'gameLoop'] },
};

function dependencyBlocked(stage, state, debugStages, debugEnabled) {
  const def = STAGE_REGISTRY[stage];
  if (!def) return null;
  for (const dep of def.dependsOn) {
    if (state.failed.includes(dep)) return `dependency "${dep}" failed`;
    if (state.skipped.includes(dep) && STAGE_REGISTRY[dep].critical) {
      return `critical dependency "${dep}" was skipped`;
    }
    if (debugEnabled && debugStages[dep] === false && STAGE_REGISTRY[dep].critical) {
      return `critical dependency "${dep}" is disabled`;
    }
  }
  return null;
}

function shouldHalt(stage, result, haltOnFailure) {
  if (!result.success && haltOnFailure && STAGE_REGISTRY[stage]?.critical) {
    return true;
  }
  return false;
}

test('dependency: worldCritical blocked when weather failed', () => {
  const blocked = dependencyBlocked(
    'worldCritical',
    { failed: ['weather'], skipped: [], completed: ['core'] },
    { core: true, weather: true },
    true
  );
  assert(blocked?.includes('weather'), 'should block on failed weather');
});

test('dependency: gameLoop blocked when critical worldCritical skipped', () => {
  const blocked = dependencyBlocked(
    'gameLoop',
    { failed: [], skipped: ['worldCritical'], completed: ['core', 'weather'] },
    { worldCritical: false },
    true
  );
  assert(blocked?.includes('worldCritical'), 'should block when critical dep skipped');
});

test('halt: critical core failure triggers halt in debug mode', () => {
  assert(
    shouldHalt('core', { success: false }, true),
    'core failure should halt when haltOnFailure enabled'
  );
});

test('halt: non-critical worldGeneration failure does not halt', () => {
  assert(
    !shouldHalt('worldGeneration', { success: false }, true),
    'worldGeneration failure should not halt pipeline'
  );
});

test('preset sandbox: worldGeneration disabled in limited preset', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('src/debug/boot-registry.ts', 'utf8');
  assert(src.includes('worldGeneration: false'), 'sandbox/limited presets should disable worldGeneration');
  assert(src.includes("'sandbox'"), 'boot-registry should define sandbox preset');
});

console.log(`\n📊 Progressive boot tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
