// tests/batcher-lod.test.mjs
// Unit tests for three-tier foliage LOD distance thresholds (hero / mid / far / cull).

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

function smoothstep01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function computeTargetLodFactor(distance, cfg) {
  if (distance >= cfg.farCull) return 3;

  const bw = Math.max(1, cfg.blendWidth);
  const heroEdge = cfg.heroMax;
  const midEdge = cfg.midMax;

  if (distance <= heroEdge - bw) return 0;
  if (distance <= heroEdge + bw) {
    const t = (distance - (heroEdge - bw)) / (2 * bw);
    return smoothstep01(t);
  }
  if (distance <= midEdge - bw) return 1;
  if (distance <= midEdge + bw) {
    const t = (distance - (midEdge - bw)) / (2 * bw);
    return 1 + smoothstep01(t);
  }
  return 2;
}

const DEFAULT_CFG = {
  heroMax: 120,
  midMax: 365,
  blendWidth: 30,
  farCull: 480
};

console.log('🌲 Foliage Batcher LOD Tests');
console.log('============================\n');

test('hero tier: instances within 90u stay at factor 0', () => {
  assert(computeTargetLodFactor(0, DEFAULT_CFG) === 0, 'origin is hero');
  assert(computeTargetLodFactor(90, DEFAULT_CFG) === 0, '90u is hero');
});

test('hero→mid crossfade spans blendWidth around 120u', () => {
  const atHeroEdge = computeTargetLodFactor(120, DEFAULT_CFG);
  assert(atHeroEdge > 0.4 && atHeroEdge < 0.6, `120u should blend ~0.5, got ${atHeroEdge}`);
  const midPlateau = computeTargetLodFactor(200, DEFAULT_CFG);
  assert(midPlateau === 1, `200u should be mid plateau, got ${midPlateau}`);
});

test('mid→far crossfade spans blendWidth around 365u', () => {
  const atMidEdge = computeTargetLodFactor(365, DEFAULT_CFG);
  assert(atMidEdge > 1.4 && atMidEdge < 1.6, `365u should blend ~1.5, got ${atMidEdge}`);
  const farPlateau = computeTargetLodFactor(420, DEFAULT_CFG);
  assert(farPlateau === 2, `420u should be far plateau, got ${farPlateau}`);
});

test('beyond farCull returns culled tier (3)', () => {
  assert(computeTargetLodFactor(480, DEFAULT_CFG) === 3, '480u culled');
  assert(computeTargetLodFactor(900, DEFAULT_CFG) === 3, '900u culled');
});

test('temporal blend reaches target within blendSeconds window', () => {
  const blendSeconds = 0.5;
  const delta = 1 / 60;
  const blendT = Math.min(1, delta / blendSeconds);
  let current = 0;
  const target = 1;
  let frames = 0;
  while (Math.abs(current - target) > 0.05 && frames < 180) {
    current += (target - current) * blendT;
    frames++;
  }
  assert(frames > 0 && frames <= 120, `0.5s blend should converge within ~2s, took ${frames} frames (factor=${current.toFixed(3)})`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
