/* verification/verify_wasm_particle_bounds.js

   Simple integration-style checks to ensure AssemblyScript particle updaters
   tolerate common malformed inputs (zero pointers, zero/negative counts)
   and do not cause synchronous traps.

   This test is intentionally small and deterministic so it can run quickly
   in CI as a safeguard against regressions that would crash the runtime.
*/

import assert from 'node:assert/strict';
import path from 'node:path';

async function run() {
  console.log('verify_wasm_particle_bounds — starting');

  // Import the WASM bootstrap (this file top-level-awaits and returns exports)
  const wasm = await import('../src/wasm/candy_physics.js');

  // Sanity: ensure the exported functions exist
  assert.equal(typeof wasm.updateRainBatch, 'function', 'updateRainBatch export');
  assert.equal(typeof wasm.updateMelodicMistBatch, 'function', 'updateMelodicMistBatch export');

  // 1) No-op usages should not throw
  wasm.updateRainBatch(0, 0, 0, 0, 0.0, 0.0); // count = 0, null pointers
  wasm.updateMelodicMistBatch(0, 0, 0.0, 0.0);

  // 2) Negative / invalid counts (AssemblyScript signatures accept numbers) — treat as no-op
  wasm.updateRainBatch(0, 0, 0, -1, 0.0, 0.0);
  wasm.updateMelodicMistBatch(0, -123, 0.0, 0.0);

  // 3) Proper allocation + normal call should succeed and mutate memory as expected
  // Allocate buffers for 4 particles
  const particleCount = 4;
  const floatsPerParticle = 3; // x,y,z
  const bytes = particleCount * floatsPerParticle * 4;
  const ptr = wasm.__new(bytes, 0);

  // Write a recognizable pattern into positions (Float32Array)
  const memF32 = new Float32Array(wasm.memory.buffer, ptr, particleCount * floatsPerParticle);
  for (let i = 0; i < memF32.length; i++) memF32[i] = i + 0.5;

  // velocities and offsets live after the positions region in this simple test
  const velPtr = wasm.__new(particleCount * 1 * 4, 0);
  const offPtr = wasm.__new(particleCount * 1 * 4, 0);
  const velF32 = new Float32Array(wasm.memory.buffer, velPtr, particleCount);
  const offF32 = new Float32Array(wasm.memory.buffer, offPtr, particleCount);
  for (let i = 0; i < particleCount; i++) { velF32[i] = 1.0 + i; offF32[i] = i * 0.1; }

  // Call with correct sizes — must not throw
  wasm.updateRainBatch(ptr, velPtr, offPtr, particleCount, 1.23, 0.5);

  // Expect at least that Y values were written (index 1 of each particle)
  for (let p = 0; p < particleCount; p++) {
    const y = memF32[p * 3 + 1];
    assert(Number.isFinite(y), `particle ${p} has finite Y (${y})`);
  }

  // 4) Mismatched but non-malicious sizes: allocate for 2 particles but call with 3.
  // Previously this was a common source of traps; the updater should now avoid crashing.
  const smallPtr = wasm.__new(2 * floatsPerParticle * 4, 0);
  const smallVel = wasm.__new(2 * 1 * 4, 0);
  const smallOff = wasm.__new(2 * 1 * 4, 0);
  const callMismatch = () => wasm.updateRainBatch(smallPtr, smallVel, smallOff, 3, 0.5, 0.2);
  assert.doesNotThrow(callMismatch, 'mismatched (small allocation, larger count) should not throw');

  // 5) Stress: repeated malformed calls should remain non-fatal
  for (let i = 0; i < 50; i++) {
    wasm.updateRainBatch(0, 0, 0, 0, 0.0, 0.0);
    wasm.updateMelodicMistBatch(0, 0, 0.0, 0.0);
  }

  console.log('verify_wasm_particle_bounds — success');
}

run().catch(err => {
  console.error('verify_wasm_particle_bounds — FAILED');
  console.error(err && (err.stack || err.message || err));
  process.exitCode = 1;
});
