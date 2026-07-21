#!/usr/bin/env node
/**
 * Cross-tier parity harness (#1351)
 *
 * Drives identical golden inputs through:
 *   TS reference → AssemblyScript WASM → Emscripten/C++ (SKIP if unavailable)
 *
 * Paths:
 *   (1) batchComposeMatrices + instance color write
 *   (2) accumulateArpeggioChannels (arpeggio_grove)
 *
 * Tolerances (documented):
 *   - Matrix / color / accumulate floats: |Δ| ≤ 1e-5
 *     WHY: f32 intermediate products (quat→matrix, volume/count) differ by at most
 *     ~1 ulp across JS Number vs WASM f32; 1e-5 covers ~10 ulp at unit scale while
 *     still catching wrong formula / column-order / nightGate bugs.
 *   - Integer counts / indices: exact equality.
 *
 * Run: npm run test:parity   (requires pnpm run build:wasm first)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { composeMatricesTS, writeInstanceColorsTS } from './parity/refs/compose-matrices.mjs';
import { accumulateArpeggioChannelsTS } from './parity/refs/accumulate-arpeggio.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const FLOAT_TOL = 1e-5;

let failures = 0;
let passes = 0;
let skips = 0;

function assertClose(label, a, b, tol = FLOAT_TOL, inputHint = '') {
  const d = Math.abs(a - b);
  if (d > tol || Number.isNaN(d)) {
    console.error(`  ✗ ${label}: got ${b}, expected ${a}, |Δ|=${d} (tol=${tol})`);
    if (inputHint) console.error(`    input: ${inputHint}`);
    failures++;
    return false;
  }
  return true;
}

function assertExact(label, a, b, inputHint = '') {
  if (a !== b) {
    console.error(`  ✗ ${label}: got ${b}, expected ${a} (exact)`);
    if (inputHint) console.error(`    input: ${inputHint}`);
    failures++;
    return false;
  }
  return true;
}

function compareF32Arrays(label, expected, actual, tol, inputHint) {
  const n = expected.length;
  if (actual.length !== n) {
    assertExact(`${label}.length`, n, actual.length, inputHint);
    return false;
  }
  for (let i = 0; i < n; i++) {
    if (!assertClose(`${label}[${i}]`, expected[i], actual[i], tol, inputHint)) {
      // Print surrounding context once
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Load AssemblyScript candy_physics.wasm
// ---------------------------------------------------------------------------
async function loadAssemblyScript() {
  const wasmPath = path.join(root, 'src/wasm/candy_physics.wasm');
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Missing ${wasmPath} — run npm run build:wasm first`);
  }
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      abort: () => { throw new Error('AS abort'); },
      seed: () => Date.now(),
      now: () => Date.now(),
    },
  });
  return instance;
}

/**
 * Run an AS function that takes pointer args using a scratch region of WASM memory.
 * Layout: sequential f32 buffers packed from baseOff.
 */
function asScratch(memory, baseOff = 262144) {
  return {
    baseOff,
    alloc(byteLen) {
      const ptr = this.baseOff;
      this.baseOff += (byteLen + 15) & ~15; // 16-byte align
      return ptr;
    },
    f32() {
      return new Float32Array(memory.buffer);
    },
    writeF32(ptr, arr) {
      this.f32().set(arr, ptr >> 2);
    },
    readF32(ptr, len) {
      return this.f32().slice(ptr >> 2, (ptr >> 2) + len);
    },
  };
}

// ---------------------------------------------------------------------------
// Load Emscripten candy_native (optional)
// ---------------------------------------------------------------------------
async function loadEmscripten() {
  const candidates = [
    path.join(root, 'public/candy_native_st.js'),
    path.join(root, 'public/candy_native.js'),
  ];
  for (const jsPath of candidates) {
    if (!fs.existsSync(jsPath)) continue;
    try {
      const mod = await import(pathToFileURL(jsPath).href);
      const factory = mod.default || mod.Module || mod.createCandyNative;
      if (typeof factory !== 'function') {
        // Some builds export Module as a promise/object already
        if (mod.default && mod.default._batchComposeMatrices_c) return mod.default;
        continue;
      }
      const instance = await factory();
      return instance;
    } catch (err) {
      console.warn(`  [C++] Failed to load ${path.basename(jsPath)}: ${err.message}`);
    }
  }

  // Raw WASM fallback (no glue) — usually fails for Emscripten; try ST wasm
  const wasmCandidates = [
    path.join(root, 'public/candy_native_st.wasm'),
    path.join(root, 'public/candy_native.wasm'),
  ];
  for (const wasmPath of wasmCandidates) {
    if (!fs.existsSync(wasmPath)) continue;
    try {
      const bytes = fs.readFileSync(wasmPath);
      // Emscripten modules need extensive imports; attempt will likely fail → SKIP
      const { instance } = await WebAssembly.instantiate(bytes, {
        env: {},
        wasi_snapshot_preview1: {},
      });
      return { raw: true, exports: instance.exports, memory: instance.exports.memory };
    } catch (err) {
      console.warn(`  [C++] Raw instantiate ${path.basename(wasmPath)} skipped: ${err.message.split('\n')[0]}`);
    }
  }
  return null;
}

function cppCompose(em, positions, quaternions, scales, count) {
  const out = new Float32Array(count * 16);
  if (!em) return null;

  // Glue Module path
  if (typeof em._batchComposeMatrices_c === 'function' && em._malloc && em.HEAPF32) {
    const pPos = em._malloc(count * 3 * 4);
    const pQuat = em._malloc(count * 4 * 4);
    const pScale = em._malloc(count * 3 * 4);
    const pMat = em._malloc(count * 16 * 4);
    em.HEAPF32.set(positions.subarray(0, count * 3), pPos >> 2);
    em.HEAPF32.set(quaternions.subarray(0, count * 4), pQuat >> 2);
    em.HEAPF32.set(scales.subarray(0, count * 3), pScale >> 2);
    em._batchComposeMatrices_c(pPos, pQuat, pScale, pMat, count);
    out.set(em.HEAPF32.subarray(pMat >> 2, (pMat >> 2) + count * 16));
    em._free(pPos); em._free(pQuat); em._free(pScale); em._free(pMat);
    return out;
  }

  // Raw export path
  const fn = em.exports && (em.exports.batchComposeMatrices_c || em.exports._batchComposeMatrices_c);
  if (fn && em.memory) {
    // Insufficient without a proper allocator — treat as unavailable
    return null;
  }
  return null;
}

function cppWriteColors(em, colorsIn, count, intensity) {
  if (!em || typeof em._batchWriteInstanceColors_c !== 'function' || !em._malloc || !em.HEAPF32) {
    return null;
  }
  const out = new Float32Array(count * 3);
  const pIn = em._malloc(count * 3 * 4);
  const pOut = em._malloc(count * 3 * 4);
  em.HEAPF32.set(colorsIn.subarray(0, count * 3), pIn >> 2);
  em._batchWriteInstanceColors_c(pIn, pOut, count, intensity);
  out.set(em.HEAPF32.subarray(pOut >> 2, (pOut >> 2) + count * 3));
  em._free(pIn); em._free(pOut);
  return out;
}

function cppAccumulate(em, volumes, shimmerCount, hueShiftCount, nightGate, intensityScale) {
  if (!em) return null;
  const fn = em._accumulateArpeggioChannels_c || em.accumulateArpeggioChannels_c
    || (em.exports && (em.exports.accumulateArpeggioChannels_c || em.exports._accumulateArpeggioChannels_c));
  if (!fn) return null; // expected SKIP until C++ export lands
  if (em._malloc && em.HEAPF32) {
    const total = shimmerCount + hueShiftCount;
    const pIn = em._malloc(Math.max(total, 1) * 4);
    const pOut = em._malloc(8);
    if (total > 0) em.HEAPF32.set(volumes.subarray(0, total), pIn >> 2);
    fn(pIn, shimmerCount, hueShiftCount, nightGate, intensityScale, pOut);
    const out = new Float32Array([
      em.HEAPF32[pOut >> 2],
      em.HEAPF32[(pOut >> 2) + 1],
    ]);
    em._free(pIn); em._free(pOut);
    return out;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Path 1: matrix + color
// ---------------------------------------------------------------------------
function runMatrixParity(asInstance, em) {
  console.log('\n══ Path 1: batchComposeMatrices + instance colors ══');
  const fixture = JSON.parse(
    fs.readFileSync(path.join(root, 'tests/fixtures/parity/matrix-compose.json'), 'utf8')
  );

  const mem = asInstance.exports.memory;
  const asCompose = asInstance.exports.batchComposeMatrices;
  const asColors = asInstance.exports.batchWriteInstanceColors;
  if (typeof asCompose !== 'function') {
    console.error('  ✗ AS missing export batchComposeMatrices');
    failures++;
    return;
  }
  if (typeof asColors !== 'function') {
    console.error('  ✗ AS missing export batchWriteInstanceColors');
    failures++;
    return;
  }

  let cppAvailable = false;

  for (const c of fixture.cases) {
    const count = c.count;
    const positions = new Float32Array(c.positions);
    const quaternions = new Float32Array(c.quaternions);
    const scales = new Float32Array(c.scales);
    const colors = new Float32Array(c.colors);
    const intensity = c.intensity;
    const hint = `case=${c.name} count=${count}`;

    // --- TS reference ---
    const tsMat = new Float32Array(count * 16);
    composeMatricesTS(positions, quaternions, scales, tsMat, count);
    const tsCol = new Float32Array(count * 3);
    writeInstanceColorsTS(colors, tsCol, count, intensity);

    // --- AS path ---
    const scratch = asScratch(mem);
    const pPos = scratch.alloc(count * 3 * 4);
    const pQuat = scratch.alloc(count * 4 * 4);
    const pScale = scratch.alloc(count * 3 * 4);
    const pMat = scratch.alloc(count * 16 * 4);
    const pColIn = scratch.alloc(count * 3 * 4);
    const pColOut = scratch.alloc(count * 3 * 4);
    scratch.writeF32(pPos, positions);
    scratch.writeF32(pQuat, quaternions);
    scratch.writeF32(pScale, scales);
    scratch.writeF32(pColIn, colors);
    asCompose(pPos, pQuat, pScale, pMat, count);
    asColors(pColIn, pColOut, count, intensity);
    const asMat = scratch.readF32(pMat, count * 16);
    const asCol = scratch.readF32(pColOut, count * 3);

    const matOk = compareF32Arrays(`AS matrix ${c.name}`, tsMat, asMat, FLOAT_TOL, hint);
    const colOk = compareF32Arrays(`AS color ${c.name}`, tsCol, asCol, FLOAT_TOL, hint);
    if (matOk && colOk) {
      console.log(`  ✓ TS↔AS  ${c.name} (matrices=${count * 16}f, colors=${count * 3}f)`);
      passes++;
    }

    // --- C++ path ---
    const cppMat = cppCompose(em, positions, quaternions, scales, count);
    const cppCol = cppWriteColors(em, colors, count, intensity);
    if (cppMat) {
      cppAvailable = true;
      let ok = compareF32Arrays(`C++ matrix ${c.name}`, tsMat, cppMat, FLOAT_TOL, hint);
      if (cppCol) {
        ok = compareF32Arrays(`C++ color ${c.name}`, tsCol, cppCol, FLOAT_TOL, hint) && ok;
      }
      if (ok) {
        console.log(`  ✓ TS↔C++ ${c.name}`);
        passes++;
      }
    }
  }

  if (!cppAvailable) {
    console.log('  ⏭ C++ SKIP — candy_native.wasm unavailable (mirrors runtime JS fallback)');
    skips++;
  }
}

// ---------------------------------------------------------------------------
// Path 2: arpeggio accumulate
// ---------------------------------------------------------------------------
function runArpeggioParity(asInstance, em) {
  console.log('\n══ Path 2: accumulateArpeggioChannels (arpeggio_grove) ══');
  const fixture = JSON.parse(
    fs.readFileSync(path.join(root, 'tests/fixtures/parity/arpeggio-accumulate.json'), 'utf8')
  );

  const mem = asInstance.exports.memory;
  const asAccum = asInstance.exports.accumulateArpeggioChannels;
  if (typeof asAccum !== 'function') {
    console.error('  ✗ AS missing export accumulateArpeggioChannels');
    failures++;
    return;
  }

  let cppAvailable = false;

  for (const c of fixture.cases) {
    const volumes = new Float32Array(c.volumes);
    const hint = `case=${c.name} nightGate=${c.nightGate} intensity=${c.intensityScale} vols=[${c.volumes.join(',')}]`;

    // Validate nightGate formula from dayNightBias (exact within f32)
    const expectedGate = 0.2 + (1.0 - c.dayNightBias) * 0.8;
    assertClose(`${c.name}.nightGate`, expectedGate, c.nightGate, FLOAT_TOL, hint);

    // --- TS ---
    const tsOut = new Float32Array(2);
    accumulateArpeggioChannelsTS(
      volumes, c.shimmerCount, c.hueShiftCount, c.nightGate, c.intensityScale, tsOut
    );

    // --- AS ---
    const scratch = asScratch(mem);
    const total = c.shimmerCount + c.hueShiftCount;
    const pIn = scratch.alloc(Math.max(total, 1) * 4);
    const pOut = scratch.alloc(8);
    if (total > 0) scratch.writeF32(pIn, volumes);
    asAccum(pIn, c.shimmerCount, c.hueShiftCount, c.nightGate, c.intensityScale, pOut);
    const asOut = scratch.readF32(pOut, 2);

    if (compareF32Arrays(`AS accum ${c.name}`, tsOut, asOut, FLOAT_TOL, hint)) {
      console.log(`  ✓ TS↔AS  ${c.name} → [${tsOut[0].toFixed(6)}, ${tsOut[1].toFixed(6)}]`);
      passes++;
    }

    // --- C++ ---
    const cppOut = cppAccumulate(em, volumes, c.shimmerCount, c.hueShiftCount, c.nightGate, c.intensityScale);
    if (cppOut) {
      cppAvailable = true;
      if (compareF32Arrays(`C++ accum ${c.name}`, tsOut, cppOut, FLOAT_TOL, hint)) {
        console.log(`  ✓ TS↔C++ ${c.name}`);
        passes++;
      }
    }
  }

  if (!cppAvailable) {
    console.log('  ⏭ C++ SKIP — accumulateArpeggioChannels_c / candy_native unavailable');
    skips++;
  }
}

// ---------------------------------------------------------------------------
async function main() {
  console.log('Cross-tier parity harness (#1351)');
  console.log(`Tolerance: |Δ| ≤ ${FLOAT_TOL} for f32; exact for integers`);
  console.log(`WHY: f32 quat→matrix / volume÷count intermediates; 1e-5 catches formula drift without flaking on ulp noise`);

  const asInstance = await loadAssemblyScript();
  console.log('AS WASM: loaded (candy_physics.wasm)');

  let em = null;
  try {
    em = await loadEmscripten();
  } catch (err) {
    console.warn(`C++ load error: ${err.message}`);
  }
  if (em) {
    console.log('C++ WASM: loaded');
  } else {
    console.log('C++ WASM: not available (will SKIP C++ tiers)');
  }

  runMatrixParity(asInstance, em);
  runArpeggioParity(asInstance, em);

  console.log('\n────────────────────────────────────────');
  console.log(`Result: ${passes} PASS, ${failures} FAIL, ${skips} SKIP`);
  if (failures > 0) {
    process.exit(1);
  }
  console.log('Parity harness green.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
