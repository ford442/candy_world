// src/core/deferred-init.ts
// Deferred visual initialization system

import * as THREE from 'three';
import { createAurora, harmonyOrbSystem } from '../foliage/aurora.ts';
import { createChromaticPulse } from '../foliage/chromatic.ts';
import { createStrobePulse } from '../foliage/strobe.ts';
import { createMelodyRibbon } from '../foliage/ribbons.ts';
import { createSparkleTrail } from '../foliage/sparkle-trail.ts';
import { createImpactSystem } from '../foliage/impacts.ts';
import { createShield } from '../foliage/shield.ts';
import { createDandelionSeedSystem } from '../foliage/dandelion-seeds.ts';
import { createDiscoveryEffect } from '../foliage/discovery-effect.ts';
import { uTime } from '../foliage/index.ts';
import { initCelestialBodies } from '../foliage/celestial-bodies.ts';
import { createFluidFog } from '../foliage/fluid_fog.ts';
import { createMushroom } from '../foliage/mushrooms.ts';
import { jitterMineSystem } from '../gameplay/jitter-mines.ts';
import { chordStrikeSystem } from '../gameplay/chord-strike.ts';
import { createHarpoonLine } from '../gameplay/harpoon-line.ts';
import { fireRainbow } from '../gameplay/rainbow-blaster.ts';
import { animatedFoliage } from '../world/state.ts';
import { getGroundHeight } from '../utils/wasm-loader.js';
import { ShaderWarmup } from '../rendering/shader-warmup.ts';
import { startPhase, endPhase, recordWarmupMetrics } from '../utils/startup-profiler.ts';

// Deferred visual elements
let aurora: THREE.Object3D | null = null;
let chromaticPulse: THREE.Object3D | null = null;
let strobePulse: THREE.Object3D | null = null;
let celestialBodiesInitialized = false;
let melodyRibbon: any = null;
let sparkleTrail: any = null;
let impactSystem: any = null;
let fluidFog: THREE.Mesh | null = null;
let playerShieldMesh: THREE.Object3D | null = null;
let dandelionSeedSystem: THREE.Object3D | null = null;
let discoveryEffect: any = null;
let harpoonLine: THREE.Mesh | null = null;

// Scene references (set during initialization)
let sceneRef: THREE.Scene | null = null;
let cameraRef: THREE.Camera | null = null;
let rendererRef: any = null;

export function initDeferredVisualsDependencies(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: any
) {
    sceneRef = scene;
    cameraRef = camera;
    rendererRef = renderer;
}

export function initDeferredVisuals() {
    if (!sceneRef || !cameraRef) {
        console.warn('[Deferred] Cannot initialize visuals: scene or camera not set');
        return;
    }

    console.time('Deferred Visuals Init');

    // Group 1: Environmental effects (order matters for layering)
    console.time('Environmental Effects');
    if (!fluidFog) {
        fluidFog = createFluidFog(200, 200); // 200x200 patch at center
        sceneRef.add(fluidFog);
        console.log('[Deferred] Fluid Fog initialized');
    }

    if (!aurora) {
        aurora = createAurora();
        sceneRef.add(aurora);
        harmonyOrbSystem.addToScene(sceneRef); // Add Harmony Orbs
        // Note: chordStrikeSystem is imported and used directly, no need to add here
        chordStrikeSystem.addToScene(sceneRef);
        console.log('[Deferred] Aurora & Systems initialized');
    }

    if (!chromaticPulse) {
        chromaticPulse = createChromaticPulse();
        cameraRef.add(chromaticPulse);
        console.log('[Deferred] Chromatic Pulse initialized');
    }

    if (!strobePulse) {
        strobePulse = createStrobePulse();
        cameraRef.add(strobePulse);
        console.log('[Deferred] Strobe Pulse initialized');
    }
    console.timeEnd('Environmental Effects');

    // Group 2: Celestial and world elements
    console.time('Celestial Elements');
    if (!celestialBodiesInitialized) {
        initCelestialBodies(sceneRef);
        celestialBodiesInitialized = true;
        console.log('[Deferred] Celestial bodies initialized');
    }
    console.timeEnd('Celestial Elements');

    // Group 3: Interactive musical elements
    console.time('Musical Elements');
    if (!melodyRibbon) {
        melodyRibbon = createMelodyRibbon(sceneRef);
        console.log('[Deferred] Melody Ribbon initialized');
    }

    if (!sparkleTrail) {
        sparkleTrail = createSparkleTrail();
        sceneRef.add(sparkleTrail);
        console.log('[Deferred] Sparkle Trail initialized');
    }

    if (!impactSystem) {
        impactSystem = createImpactSystem();
        sceneRef.add(impactSystem);
        console.log('[Deferred] Impact System initialized');
    }

    if (!dandelionSeedSystem) {
        dandelionSeedSystem = createDandelionSeedSystem();
        sceneRef.add(dandelionSeedSystem);
        console.log('[Deferred] Dandelion Seed System initialized');
    }

    if (!discoveryEffect) {
        discoveryEffect = createDiscoveryEffect();
        sceneRef.add(discoveryEffect.mesh);
        console.log('[Deferred] Discovery Effect initialized');

        // Export to global for easy triggering from discovery-optimized.ts
        (window as any).triggerDiscoveryEffect = (position: THREE.Vector3) => {
            if (discoveryEffect && discoveryEffect.trigger) {
                // Ensure we use the current global shader time
                discoveryEffect.trigger(position, uTime.value);
            }
        };
    }

    if (jitterMineSystem.mesh && !jitterMineSystem.mesh.parent) {
        sceneRef.add(jitterMineSystem.mesh);
        console.log('[Deferred] Jitter Mine System initialized');
    }

    if (!harpoonLine) {
        harpoonLine = createHarpoonLine();
        sceneRef.add(harpoonLine);
        console.log('[Deferred] Harpoon Line initialized');
    }
    console.timeEnd('Musical Elements');

    console.timeEnd('Deferred Visuals Init');
}

// --- DEFERRED INCREMENTAL SHADER WARMUP ---
// Runs 2 seconds after world generation to pre-compile remaining shaders without
// blocking the main thread. Uses ShaderWarmup in time-budgeted batches so no
// single task exceeds WARMUP_BUDGET_MS.

/** Number of materials compiled per batch before yielding to the event loop. */
const WARMUP_BATCH_SIZE = 10;
/** Maximum milliseconds allowed per warmup batch before yielding. */
const WARMUP_BUDGET_MS = 100;

/** Set to true to cancel an in-progress deferred warmup (e.g. on scene transition). */
let _warmupAborted = false;

/** Cancel any in-progress deferred shader warmup. */
export function abortWarmup(): void {
    _warmupAborted = true;
}

export function runDeferredWarmup(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: any
) {
    _warmupAborted = false;

    setTimeout(async () => {
        startPhase('Shader Warmup');
        performance.mark('candy:shader-warmup-start');
        console.log('[Deferred] Starting incremental shader pre-compilation...');

        // FIX: Ensure clipping planes are defined before compilation.
        // WebGPURenderer 0.171.0+ can crash in setupHardwareClipping if undefined.
        if (renderer.clippingPlanes === undefined || renderer.clippingPlanes === null) {
            renderer.clippingPlanes = [];
            renderer.localClippingEnabled = false;
            console.log('[Deferred] Re-applied clipping planes fix (Safety Force).');
        }

        // Keep the rainbow blaster warmup — it uses a distinct particle material.
        const dummyOrigin = new THREE.Vector3(0, -9999, 0);
        const dummyDir = new THREE.Vector3(0, 1, 0);
        fireRainbow(scene, dummyOrigin, dummyDir);

        let warmupBatches = 0;
        let warmupBatchMaxMs = 0;

        try {
            // --- Phase 1: Compile predefined foliage / preset materials in batches ---
            // ShaderWarmup renders each material in a 1×1 pixel target and disposes
            // the temporary mesh+render-target; the original scene materials are unaffected.
            const warmup = new ShaderWarmup();
            const targets = warmup.getTargets();

            for (let i = 0; i < targets.length; i += WARMUP_BATCH_SIZE) {
                if (_warmupAborted) break;

                const batchStart = performance.now();
                const batch = targets.slice(i, i + WARMUP_BATCH_SIZE);

                for (const target of batch) {
                    if (_warmupAborted) break;
                    const mat = target.create();
                    try {
                        await warmup.warmupSingle(mat, renderer, target.name);
                    } catch (_e) {
                        // Non-fatal: continue with next material.
                    }
                }

                const batchMs = performance.now() - batchStart;
                warmupBatches++;
                if (batchMs > warmupBatchMaxMs) warmupBatchMaxMs = batchMs;

                // Always yield between batches to stay within the 100 ms long-task budget.
                await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
            warmup.dispose();

            // --- Phase 2: Compile materials found on actual scene objects ---
            // Frustum-visible objects are prioritised so the player's current view
            // is fully warmed before off-screen geometry.
            if (!_warmupAborted) {
                const frustum = new THREE.Frustum();
                const projMatrix = new THREE.Matrix4().multiplyMatrices(
                    (camera as any).projectionMatrix,
                    (camera as any).matrixWorldInverse
                );
                frustum.setFromProjectionMatrix(projMatrix);

                // Collect unique materials from scene meshes.
                const sceneEntries: Array<{ mat: THREE.Material; inFrustum: boolean }> = [];
                const seenIds = new Set<number>();

                scene.traverse((obj: THREE.Object3D) => {
                    if (!(obj instanceof THREE.Mesh) || !obj.visible) return;
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                    const inFrustum = frustum.intersectsObject(obj);
                    for (const mat of mats) {
                        if (!mat || seenIds.has(mat.id)) continue;
                        seenIds.add(mat.id);
                        sceneEntries.push({ mat, inFrustum });
                    }
                });

                // Frustum-visible first.
                sceneEntries.sort((a, b) => (a.inFrustum ? 0 : 1) - (b.inFrustum ? 0 : 1));

                // Compile each material by cloning it so warmupSingle can safely dispose
                // the clone while the original in the scene remains intact.
                const sceneWarmup = new ShaderWarmup();
                for (let i = 0; i < sceneEntries.length; i += WARMUP_BATCH_SIZE) {
                    if (_warmupAborted) break;

                    const batchStart = performance.now();
                    const batch = sceneEntries.slice(i, i + WARMUP_BATCH_SIZE);

                    for (const { mat } of batch) {
                        if (_warmupAborted) break;
                        try {
                            // Clone so warmupSingle can dispose the temporary copy.
                            const clone = mat.clone();
                            await sceneWarmup.warmupSingle(clone, renderer, `scene_${mat.id}`);
                        } catch (_e) { /* skip */ }
                    }

                    const batchMs = performance.now() - batchStart;
                    warmupBatches++;
                    if (batchMs > warmupBatchMaxMs) warmupBatchMaxMs = batchMs;

                    // Yield if the batch took too long or more batches remain.
                    if (batchMs > WARMUP_BUDGET_MS || i + WARMUP_BATCH_SIZE < sceneEntries.length) {
                        await new Promise<void>(resolve => setTimeout(resolve, 0));
                    }
                }
                sceneWarmup.dispose();
            }

            console.log(
                `✅ Scene shaders pre-compiled (${warmupBatches} batch${warmupBatches !== 1 ? 'es' : ''}, ` +
                `max ${warmupBatchMaxMs.toFixed(0)} ms/batch).`
            );
        } catch (e) {
            console.warn('[Warmup] Shader compilation error:', e);
        }

        // Record warmup metrics for the startup profiler report.
        recordWarmupMetrics(warmupBatches, warmupBatchMaxMs);

        performance.mark('candy:shader-warmup-end');
        try {
            performance.measure('candy:Shader Warmup', 'candy:shader-warmup-start', 'candy:shader-warmup-end');
        } catch (_e) { /* ignore if marks were cleared */ }

        console.log('[Deferred] Shader compilation complete');
        endPhase('Shader Warmup');
    }, 2000); // 2-second delay lets the browser settle after initial load.
}

// Getters for deferred objects (used by game-loop)
export function getMelodyRibbon() { return melodyRibbon; }
export function getSparkleTrail() { return sparkleTrail; }
export function getImpactSystem() { return impactSystem; }
export function getFluidFog() { return fluidFog; }
export function getDandelionSeedSystem() { return dandelionSeedSystem; }
export function getDiscoveryEffect() { return discoveryEffect; }
export function getHarpoonLine() { return harpoonLine; }
export function getAurora() { return aurora; }
export function getChromaticPulse() { return chromaticPulse; }
export function getStrobePulse() { return strobePulse; }
export function getPlayerShieldMesh() { return playerShieldMesh; }
export function setPlayerShieldMesh(mesh: THREE.Object3D | null) { playerShieldMesh = mesh; }
