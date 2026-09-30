/**
 * @file COMPUTE_PARTICLES_USAGE.md
 * @description Integration Guide for WebGPU Compute Particles
 * 
 * This file shows how to integrate the compute particle system into
 * the existing Candy World codebase.
 */

// =============================================================================
// OPTION 1: Drop-in Replacement (Recommended)
// =============================================================================

// In src/world/generation.ts, replace:
// import { createFireflies } from '../foliage/index.ts';

// With:
import { createIntegratedFireflies } from '../particles/index.ts';

// Then change:
// scene.add(createFireflies(150, 100));

// To:
const fireflies = createIntegratedFireflies({ 
    count: 150, 
    areaSize: 100,
    useCompute: true // Automatically uses GPU if available
});
scene.add(fireflies);

// =============================================================================
// OPTION 2: Direct Compute System Usage
// =============================================================================

// In src/world/generation.ts:
import { createComputeFireflies, registerIntegratedSystem } from '../particles/index.ts';

// Create high-performance firefly system
const fireflySystem = createComputeFireflies({
    count: 50000,  // 300x more particles!
    bounds: { x: 100, y: 15, z: 100 },
    center: new THREE.Vector3(0, 3, 0)
});

scene.add(fireflySystem.mesh);
registerIntegratedSystem('fireflies', fireflySystem.mesh, fireflySystem);

// =============================================================================
// OPTION 3: In main.ts Animation Loop
// =============================================================================

// Add to imports:
import { updateAllIntegratedSystems } from './particles/index.ts';

// In the animate() function, add after music reactivity update:
profiler.measure('Particles', () => {
    const audioData = {
        low: audioState?.kickTrigger || 0,
        mid: 0.3,
        high: audioState?.energy || 0,
        beat: (audioState?.beatPhase || 0) < 0.1,
        groove: audioState?.grooveAmount || 0,
        windX: weatherSystem.windDirection.x,
        windZ: weatherSystem.windDirection.z,
        windSpeed: weatherState === WeatherState.STORM ? 0.8 : 0.2
    };
    
    updateAllIntegratedSystems(renderer, delta, player.position, audioData);
});

// =============================================================================
// OPTION 4: Deferred Loading (Best for Startup Performance)
// =============================================================================

// In initDeferredVisuals() in main.ts:
import { queueDeferredSystem, loadDeferredSystems } from './particles/index.ts';

// Queue systems for deferred loading
queueDeferredSystem({
    id: 'fireflies',
    type: 'fireflies',
    options: { count: 50000, areaSize: 100 },
    priority: 1  // Lower = load first
});

queueDeferredSystem({
    id: 'pollen',
    type: 'pollen',
    options: { count: 30000, areaSize: 50 },
    priority: 2
});

// Load all queued systems (call this in initDeferredVisuals)
await loadDeferredSystems(scene, (loaded, total) => {
    console.log(`Loading particles: ${loaded}/${total}`);
});

// =============================================================================
// UPDATING EXISTING FIREFLIES RENDER
// =============================================================================

// In main.ts animate(), replace existing fireflies update:
/*
if (fireflies) {
    fireflies.visible = isDeepNight;
    if (isDeepNight && fireflies.userData.computeNode) {
        renderer.compute(fireflies.userData.computeNode);
    }
}
*/

// With:
if (fireflies) {
    fireflies.visible = isDeepNight;
    // Compute particles auto-update via updateAllIntegratedSystems
}

// =============================================================================
// BENCHMARKING
// =============================================================================

// Run performance benchmark:
import { benchmarkParticleSystem, printBenchmarkResults } from './particles/index.ts';

const results = await benchmarkParticleSystem(renderer, 'fireflies', [1000, 5000, 10000, 50000]);
printBenchmarkResults(results);

// Output:
// === Particle System Benchmark ===
// ┌─────────┬─────────┬──────┬─────────────────┐
// │ Count   │ Avg ms  │ FPS  │ Recommendation  │
// ├─────────┼─────────┼──────┼─────────────────┤
// │ 1,000   │ 0.012   │ 60.0 │ Optimal         │
// │ 5,000   │ 0.025   │ 60.0 │ Optimal         │
// │ 10,000  │ 0.048   │ 60.0 │ Optimal         │
// │ 50,000  │ 0.156   │ 60.0 │ Acceptable      │
// └─────────┴─────────┴──────┴─────────────────┘

// =============================================================================
// METRICS MONITORING
// =============================================================================

// Get performance metrics:
import { getAllParticleMetrics } from './particles/index.ts';

setInterval(() => {
    const metrics = getAllParticleMetrics();
    for (const [id, metric] of metrics) {
        console.log(`${id}: ${metric.particleCount} particles, ${metric.frameTime.toFixed(2)}ms`);
    }
}, 5000);

// =============================================================================
// FALLBACK HANDLING
// =============================================================================

// The system automatically falls back to CPU if WebGPU is unavailable.
// To check if using GPU:
const system = createIntegratedFireflies({ count: 150 });
const isGPU = system.userData.computeParticleSystem?.['usingGPU'] ?? false;
console.log('Using GPU:', isGPU);

// To force CPU fallback:
const cpuFireflies = createIntegratedFireflies({ 
    count: 150, 
    useCompute: false 
});
