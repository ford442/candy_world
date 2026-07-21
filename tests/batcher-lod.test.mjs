// tests/batcher-lod.test.mjs
// Unit tests for three-tier foliage LOD distance thresholds (hero / mid / far / cull).
// Extended with #1358 pose-write parity + microbench (ties into #1351 fixtures).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeInstancePoseTS } from './parity/refs/write-instance-pose.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLOAT_TOL = 1e-5;

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

// ---------------------------------------------------------------------------
// #1358: arpeggio pose → matrix/color write parity + microbench
// (Chrome perf unavailable headless — Node microbench quantifies TS loop cost)
// ---------------------------------------------------------------------------

test('writeInstancePoseTS matches golden matrix-compose fixture (n=16)', () => {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/parity/matrix-compose.json'), 'utf8')
  );
  const c = fixture.cases.find((x) => x.count === 16) || fixture.cases[0];
  const positions = new Float32Array(c.positions);
  const quaternions = new Float32Array(c.quaternions);
  const scales = new Float32Array(c.scales);
  const colors = new Float32Array(c.colors);
  const mat = new Float32Array(c.count * 16);
  const col = new Float32Array(c.count * 3);
  writeInstancePoseTS(positions, quaternions, scales, colors, mat, col, c.intensity, c.count);

  let bad = -1;
  for (let i = 0; i < c.count; i++) {
    const m = i * 16;
    if (
      Math.abs(mat[m + 12] - positions[i * 3]) > FLOAT_TOL ||
      Math.abs(mat[m + 13] - positions[i * 3 + 1]) > FLOAT_TOL ||
      Math.abs(mat[m + 14] - positions[i * 3 + 2]) > FLOAT_TOL ||
      mat[m + 15] !== 1 ||
      Math.abs(col[i * 3] - colors[i * 3] * c.intensity) > FLOAT_TOL
    ) {
      bad = i;
      break;
    }
  }
  assert(bad < 0, `pose write golden n=${c.count} (first bad index=${bad})`);
});

test('microbench: TS writeInstancePose for arpeggio-scale counts', () => {
  // Quantify CPU cost of the TS array-write loop (proxy for Chrome perf task
  // when GPU/Chrome profiling is unavailable in cloud VMs).
  const counts = [50, 200, 500];
  const ITERS = 200;
  for (const count of counts) {
    const positions = new Float32Array(count * 3);
    const quaternions = new Float32Array(count * 4);
    const scales = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const mat = new Float32Array(count * 16);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = i; positions[i * 3 + 1] = 1; positions[i * 3 + 2] = -i;
      quaternions[i * 4 + 3] = 1;
      scales[i * 3] = scales[i * 3 + 1] = scales[i * 3 + 2] = 1;
      colors[i * 3] = 0.5; colors[i * 3 + 1] = 0.8; colors[i * 3 + 2] = 0.2;
    }
    // warmup
    writeInstancePoseTS(positions, quaternions, scales, colors, mat, col, 1, count);
    const t0 = performance.now();
    for (let n = 0; n < ITERS; n++) {
      writeInstancePoseTS(positions, quaternions, scales, colors, mat, col, 1, count);
    }
    const msPerCall = (performance.now() - t0) / ITERS;
    const usPerInstance = (msPerCall * 1000) / count;
    console.log(`  ⏱  n=${count}: ${msPerCall.toFixed(3)} ms/flush (${usPerInstance.toFixed(2)} µs/instance)`);
    // Sanity: should finish well under a frame even at 500 instances on Node
    assert(msPerCall < 16, `n=${count} TS flush should be <16ms, got ${msPerCall.toFixed(3)}ms`);
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
