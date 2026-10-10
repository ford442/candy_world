// tests/wasm.mjs
// WASM particle bounds test
// Verifies that particle physics stays within documented world bounds

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);

// World bounds derived from constants.ts in assembly/
// GRID dimensions: 16x16 cells of 16.0 units each
// GRID_ORIGIN: (-128, -128)
// Total grid bounds: [-128, 128] x [-128, 128]
const WORLD_MIN_X = -128.0;
const WORLD_MAX_X = 128.0;
const WORLD_MIN_Z = -128.0;
const WORLD_MAX_Z = 128.0;
const WORLD_MIN_Y = -100.0; // Particles can fall below ground
const WORLD_MAX_Y = 500.0;  // Particles can reach high in the sky

// Particle data layout (from assembly/particles.ts):
// Each particle: [x, y, z, vx, vy, vz] = 6 floats per particle
const STRIDE_F32 = 4;
const FLOATS_PER_PARTICLE = 6;

/**
 * Load WASM module from src/wasm/candy_physics.wasm
 */
async function loadWasm() {
  const wasmPath = path.join(__dirname, '..', 'src', 'wasm', 'candy_physics.wasm');

  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM file not found at ${wasmPath}`);
  }

  const wasmBuffer = fs.readFileSync(wasmPath);

  // Create env object for WASM imports
  const env = {
    abort: (message, fileName, lineNumber, columnNumber) => {
      throw new Error(`WASM abort: ${message}`);
    },
    seed: () => {
      // Return a double precision random value for AssemblyScript's seeding
      return Math.random();
    },
  };

  const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env });
  return wasmModule.instance;
}

/**
 * Verify particle bounds after physics update
 */
function verifyParticleBounds(
  memory,
  particlesPtr,
  count,
  expectedMin,
  expectedMax,
  testName
) {
  const buffer = new Float32Array(memory.buffer);

  for (let i = 0; i < count; i++) {
    const baseIndex = (particlesPtr + i * FLOATS_PER_PARTICLE * STRIDE_F32) / STRIDE_F32;

    const x = buffer[baseIndex];
    const y = buffer[baseIndex + 1];
    const z = buffer[baseIndex + 2];

    // Check bounds
    if (
      x < expectedMin.x || x > expectedMax.x ||
      y < expectedMin.y || y > expectedMax.y ||
      z < expectedMin.z || z > expectedMax.z
    ) {
      throw new Error(
        `${testName}: Particle ${i} out of bounds at (${x}, ${y}, ${z}) ` +
        `expected bounds: x[${expectedMin.x}, ${expectedMax.x}], ` +
        `y[${expectedMin.y}, ${expectedMax.y}], ` +
        `z[${expectedMin.z}, ${expectedMax.z}]`
      );
    }
  }
}

/**
 * Test 1: Basic particle update within bounds
 */
async function testParticleUpdate(wasmInstance) {
  console.log('Test 1: Basic particle update within bounds...');

  const memory = wasmInstance.exports.memory;
  const updateParticles = wasmInstance.exports.updateParticles;

  // Allocate particle data in WASM memory
  // Particles at: buffer offset = 8192 (OUTPUT_OFFSET from constants.ts)
  const particlesPtr = 8192;
  const particleCount = 10;
  const dt = 0.016; // 16ms timestep
  const gravity = -9.8;

  const buffer = new Float32Array(memory.buffer);

  // Initialize particles with known positions and velocities
  for (let i = 0; i < particleCount; i++) {
    const baseIndex = (particlesPtr + i * FLOATS_PER_PARTICLE * STRIDE_F32) / STRIDE_F32;

    // Position: spread around origin
    buffer[baseIndex] = (i - 5) * 10.0; // x: -50 to 40
    buffer[baseIndex + 1] = 50.0;       // y: start at 50
    buffer[baseIndex + 2] = (i - 5) * 10.0; // z: -50 to 40

    // Velocity: upward with spread
    buffer[baseIndex + 3] = 5.0;  // vx
    buffer[baseIndex + 4] = 20.0; // vy: upward
    buffer[baseIndex + 5] = 5.0;  // vz
  }

  // Update particles for 100 frames (1.6 seconds)
  for (let frame = 0; frame < 100; frame++) {
    updateParticles(particlesPtr, particleCount, dt, gravity);

    // Verify bounds after each frame
    verifyParticleBounds(
      memory,
      particlesPtr,
      particleCount,
      { x: WORLD_MIN_X, y: WORLD_MIN_Y, z: WORLD_MIN_Z },
      { x: WORLD_MAX_X, y: WORLD_MAX_Y, z: WORLD_MAX_Z },
      `Frame ${frame}`
    );
  }

  console.log('✓ Test 1 passed: Particles stayed within bounds for 100 frames');
}

/**
 * Test 2: Particle spawn burst
 */
async function testSpawnBurst(wasmInstance) {
  console.log('Test 2: Particle spawn burst...');

  const memory = wasmInstance.exports.memory;
  const spawnBurst = wasmInstance.exports.spawnBurst;
  const updateParticles = wasmInstance.exports.updateParticles;

  // Allocate particles at OUTPUT_OFFSET
  const particlesPtr = 8192;
  const particleCount = 50;
  const centerX = 0.0;
  const centerY = 50.0;
  const centerZ = 0.0;
  const speed = 20.0;
  const time = 0.0;

  // Spawn particles
  spawnBurst(particlesPtr, particleCount, centerX, centerY, centerZ, speed, time);

  console.log(`  Spawned ${particleCount} particles at (${centerX}, ${centerY}, ${centerZ})`);

  // Update particles for 50 frames
  const dt = 0.016;
  const gravity = -9.8;

  for (let frame = 0; frame < 50; frame++) {
    updateParticles(particlesPtr, particleCount, dt, gravity);

    verifyParticleBounds(
      memory,
      particlesPtr,
      particleCount,
      { x: WORLD_MIN_X, y: WORLD_MIN_Y, z: WORLD_MIN_Z },
      { x: WORLD_MAX_X, y: WORLD_MAX_Y, z: WORLD_MAX_Z },
      `Burst frame ${frame}`
    );
  }

  console.log('✓ Test 2 passed: Spawned particles stayed within bounds for 50 frames');
}

/**
 * Test 3: Extreme velocity particles
 */
async function testExtremeVelocity(wasmInstance) {
  console.log('Test 3: Extreme velocity particles...');

  const memory = wasmInstance.exports.memory;
  const updateParticles = wasmInstance.exports.updateParticles;

  const particlesPtr = 8192;
  const particleCount = 5;
  const dt = 0.016;
  const gravity = -9.8;

  const buffer = new Float32Array(memory.buffer);

  // Initialize particles with extreme velocities
  for (let i = 0; i < particleCount; i++) {
    const baseIndex = (particlesPtr + i * FLOATS_PER_PARTICLE * STRIDE_F32) / STRIDE_F32;

    buffer[baseIndex] = 0.0;     // x
    buffer[baseIndex + 1] = 0.0; // y
    buffer[baseIndex + 2] = 0.0; // z

    // Extreme velocities in different directions
    const multiplier = 100.0 + i * 50.0;
    buffer[baseIndex + 3] = multiplier;  // vx
    buffer[baseIndex + 4] = multiplier;  // vy
    buffer[baseIndex + 5] = multiplier;  // vz
  }

  // Update for multiple frames
  for (let frame = 0; frame < 20; frame++) {
    updateParticles(particlesPtr, particleCount, dt, gravity);

    verifyParticleBounds(
      memory,
      particlesPtr,
      particleCount,
      { x: WORLD_MIN_X, y: WORLD_MIN_Y, z: WORLD_MIN_Z },
      { x: WORLD_MAX_X, y: WORLD_MAX_Y, z: WORLD_MAX_Z },
      `Extreme velocity frame ${frame}`
    );
  }

  console.log('✓ Test 3 passed: Extreme velocity particles stayed within bounds');
}

/**
 * Test 4: Batch distance cull flags override bug
 */
async function testBatchDistanceCull(wasmInstance) {
  console.log('Test 4: Batch distance cull flags override bug...');

  const memory = wasmInstance.exports.memory;
  const batchDistanceCull = wasmInstance.exports.batchDistanceCull;
  const F32 = new Float32Array(memory.buffer);
  const OUTPUT_OFFSET_FLOATS = 8192 / 4;

  // Set positions (at offset 0)
  F32[0] = 10; F32[1] = 0; F32[2] = 0; F32[3] = 1; // x, y, z, r
  F32[4] = 20; F32[5] = 0; F32[6] = 0; F32[7] = 1;

  // Sentinel value
  F32[OUTPUT_OFFSET_FLOATS] = 7;
  F32[OUTPUT_OFFSET_FLOATS + 1] = 7;

  // Call with 6 arguments (including flagsPtr at 8192)
  batchDistanceCull(0, 0, 0, 225, 2, 8192); // distSq = 15*15 = 225

  // Assert flags were written to 8192
  if (F32[OUTPUT_OFFSET_FLOATS] !== 1 || F32[OUTPUT_OFFSET_FLOATS + 1] !== 0) {
    throw new Error(`testBatchDistanceCull failed: Expected flags [1, 0] at 8192, got [${F32[OUTPUT_OFFSET_FLOATS]}, ${F32[OUTPUT_OFFSET_FLOATS + 1]}]`);
  }

  // Assert position buffer at 0 was untouched
  if (F32[0] !== 10) {
    throw new Error(`testBatchDistanceCull failed: Position buffer was overwritten! Expected 10, got ${F32[0]}`);
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🎮 Candy World WASM Particle Bounds Test');
  console.log('========================================\n');

  try {
    console.log('Loading WASM module...');
    const wasmInstance = await loadWasm();
    console.log('✓ WASM module loaded successfully\n');

    await testParticleUpdate(wasmInstance);
    console.log();

    await testSpawnBurst(wasmInstance);
    console.log();

    await testExtremeVelocity(wasmInstance);
    console.log();

    await testBatchDistanceCull(wasmInstance);
    console.log();

    console.log('✅ All WASM tests passed!');
    return true;
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    return false;
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

export default runAllTests;
