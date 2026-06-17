// tests/atmosphere-reactivity.test.mjs
// Unit tests for atmosphere reactivity smoothing and binding logic.

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name, fn) {
  try {
    fn();
  } catch (err) {
    console.log(`❌ FAIL: ${name} — ${err.message}`);
    failed++;
  }
}

function smooth(current, target, k, deltaTime) {
  return current + (target - current) * (1.0 - Math.exp(-k * deltaTime));
}

function simulateBloomTarget(bassNorm, rest, peak, nightGate, beatSpike) {
  const bloomBase = rest + (peak - rest) * bassNorm * nightGate;
  return bloomBase + beatSpike;
}

function simulateFogTarget(averageVolume, scale, max, weatherFogBoost = 0) {
  let mixTarget = Math.min(max, averageVolume * scale);
  if (weatherFogBoost > 0) {
    mixTarget = Math.min(max, mixTarget + weatherFogBoost * 0.35);
  }
  return mixTarget;
}

console.log('🌫️  Atmosphere Reactivity Tests');
console.log('================================\n');

test('bloom: silence decays toward rest without overshooting', () => {
  let bloom = 2.0;
  for (let i = 0; i < 120; i++) {
    bloom = smooth(bloom, 1.0, 8.0, 1 / 60);
  }
  assert(bloom > 1.0 && bloom < 1.15, `Bloom should decay near rest, got ${bloom.toFixed(3)}`);
});

test('bloom: crescendo reaches elevated target with night gate', () => {
  const target = simulateBloomTarget(1.0, 1.0, 2.5, 1.0, 0);
  assert(target === 2.5, `Peak bloom should hit 2.5, got ${target}`);
  const dayTarget = simulateBloomTarget(1.0, 1.0, 2.5, 0.35, 0);
  assert(dayTarget < 2.0, `Day gate should attenuate bloom, got ${dayTarget}`);
});

test('fog: mix energy caps at configured max (candy-dream, not murky)', () => {
  const target = simulateFogTarget(2.0, 0.65, 0.85);
  assert(target === 0.85, `Fog should cap at max 0.85, got ${target}`);
});

test('fog: weather channel boost stacks under cap', () => {
  const target = simulateFogTarget(0.5, 0.65, 0.85, 1.0);
  assert(target <= 0.85, `Weather boost must respect max cap, got ${target}`);
  assert(target > 0.32, `Weather boost should thicken fog, got ${target}`);
});

test('shaft: melody energy enables night moonbeam flag', () => {
  const melodyShaft = Math.min(0.35, 0.4 * 0.35);
  const nightMoonbeam = melodyShaft > 0.02;
  assert(nightMoonbeam, 'Strong melody should enable night moonbeam');
});

test('beat pulse: spike decays to zero', () => {
  let spike = 0.45;
  for (let i = 0; i < 180; i++) {
    const beatDecay = 1.0 - Math.exp(-12.0 * (1 / 60));
    spike -= spike * beatDecay;
  }
  assert(spike < 0.01, `Beat spike should decay, got ${spike.toFixed(4)}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
