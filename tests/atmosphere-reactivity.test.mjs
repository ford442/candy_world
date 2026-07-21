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

// ---------------------------------------------------------------------------
// arpeggio_grove channel accumulate (migration slice 2 / #1364)
// Mirrors assembly/music_reactivity.ts + wasm-music-reactivity.ts TS fallback.
// ---------------------------------------------------------------------------

function accumulateArpeggioChannels(
  volumes,
  shimmerCount,
  hueShiftCount,
  nightGate,
  intensityScale,
  outResult
) {
  let shimmerAccum = 0.0;
  for (let i = 0; i < shimmerCount; i++) shimmerAccum += volumes[i];
  let hueShiftAccum = 0.0;
  const end = shimmerCount + hueShiftCount;
  for (let i = shimmerCount; i < end; i++) hueShiftAccum += volumes[i];

  const shimmerDiv = shimmerCount > 1 ? shimmerCount : 1.0;
  let shimmerVal = shimmerAccum / shimmerDiv;
  if (shimmerVal > 1.0) shimmerVal = 1.0;
  outResult[0] = shimmerVal * nightGate * intensityScale;

  const hueShiftDiv = hueShiftCount > 1 ? hueShiftCount : 1.0;
  let hueShiftVal = hueShiftAccum / hueShiftDiv;
  if (hueShiftVal > 1.0) hueShiftVal = 1.0;
  outResult[1] = hueShiftVal * nightGate * intensityScale;
}

function nightGateFromBias(dayNightBias) {
  return 0.2 + (1.0 - dayNightBias) * 0.8;
}

console.log('\n🎵  Arpeggio Grove Accumulate');
console.log('==============================\n');

test('arpeggio: night full energy writes scaled shimmer/hueShift', () => {
  // music-bindings defaults: shimmer [3,4], hueShift [5] → packed volumes length 3
  const volumes = new Float32Array([0.8, 0.6, 0.4]);
  const out = new Float32Array(2);
  const nightGate = nightGateFromBias(0);
  accumulateArpeggioChannels(volumes, 2, 1, nightGate, 1.0, out);
  assert(Math.abs(nightGate - 1.0) < 1e-9, `nightGate at bias=0 should be 1, got ${nightGate}`);
  assert(Math.abs(out[0] - 0.7) < 1e-6, `shimmer should be 0.7, got ${out[0]}`);
  assert(Math.abs(out[1] - 0.4) < 1e-6, `hueShift should be 0.4, got ${out[1]}`);
});

test('arpeggio: day gate attenuates to 0.2×', () => {
  const volumes = new Float32Array([0.8, 0.6, 0.4]);
  const out = new Float32Array(2);
  const nightGate = nightGateFromBias(1);
  accumulateArpeggioChannels(volumes, 2, 1, nightGate, 1.0, out);
  assert(Math.abs(nightGate - 0.2) < 1e-9, `nightGate at bias=1 should be 0.2, got ${nightGate}`);
  assert(Math.abs(out[0] - 0.14) < 1e-6, `day shimmer should be 0.14, got ${out[0]}`);
  assert(Math.abs(out[1] - 0.08) < 1e-6, `day hueShift should be 0.08, got ${out[1]}`);
});

test('arpeggio: clip volumes above 1 before nightGate', () => {
  const volumes = new Float32Array([1.5, 1.2, 2.0]);
  const out = new Float32Array(2);
  accumulateArpeggioChannels(volumes, 2, 1, 1.0, 1.0, out);
  assert(out[0] === 1.0, `clipped shimmer should be 1, got ${out[0]}`);
  assert(out[1] === 1.0, `clipped hueShift should be 1, got ${out[1]}`);
});

test('arpeggio: silence yields zeros', () => {
  const volumes = new Float32Array([0, 0, 0]);
  const out = new Float32Array(2);
  accumulateArpeggioChannels(volumes, 2, 1, 1.0, 1.0, out);
  assert(out[0] === 0 && out[1] === 0, `silent should be [0,0], got [${out[0]}, ${out[1]}]`);
});

test('arpeggio: intensityScale multiplies both outputs', () => {
  const volumes = new Float32Array([0.5, 0.5, 0.5]);
  const out = new Float32Array(2);
  accumulateArpeggioChannels(volumes, 2, 1, 1.0, 1.5, out);
  assert(Math.abs(out[0] - 0.75) < 1e-6, `scaled shimmer should be 0.75, got ${out[0]}`);
  assert(Math.abs(out[1] - 0.75) < 1e-6, `scaled hueShift should be 0.75, got ${out[1]}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
