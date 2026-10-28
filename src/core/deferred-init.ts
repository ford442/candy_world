// src/core/deferred-init.ts
// Deferred visual initialization system

import * as THREE from 'three';
import { createAurora, harmonyOrbSystem } from '../foliage/aurora.ts';
import { initCelestialBodies } from '../foliage/celestial-bodies.ts';
import { createChromaticPulse } from '../foliage/chromatic.ts';
import { createDandelionSeedSystem } from '../foliage/dandelion-seeds.ts';
import { createDiscoveryEffect } from '../foliage/discovery-effect.ts';
import { createFluidFog } from '../foliage/fluid-fog.ts';
import { createImpactSystem } from '../foliage/impacts.ts';
import { uTime } from '../foliage/index.ts';
import { createMelodyRibbon } from '../foliage/ribbons.ts';
import { createSparkleTrail } from '../foliage/sparkle-trail.ts';
import { createStrobePulse } from '../foliage/strobe.ts';
import { ensureGameplay, preloadGameplay } from '../gameplay/lazy.ts';
import { initAwakenedPersistenceIfNeeded } from '../systems/awakened-persistence-api.ts';
import { log } from '../utils/log.ts';
import { startPhase, endPhase, recordWarmupMetrics } from '../utils/startup-profiler.ts';
import { FEATURE_FLAGS } from './config.ts';
import type { CompileTarget } from '../rendering/shader-warmup.ts';
import { isWebGLNodeBackend, type CandyRenderer } from './init.ts';
import { isAutomation } from './platform/run-mode.ts';
import { getStartupCapabilities } from './startup/capabilities.ts';

// Deferred visual elements
let aurora: THREE.Object3D | null = null;
let chromaticPulse: THREE.Object3D | null = null;
let strobePulse: THREE.Object3D | null = null;
let celestialBodiesInitialized = false;
let melodyRibbon: THREE.Group | null = null;
let sparkleTrail: THREE.Points | null = null;
let impactSystem: THREE.InstancedMesh | null = null;
let fluidFog: THREE.Mesh | null = null;
let playerShieldMesh: THREE.Object3D | null = null;
let dandelionSeedSystem: THREE.Object3D | null = null;
let discoveryEffect: ReturnType<typeof createDiscoveryEffect> | null = null;
let harpoonLine: THREE.Mesh | null = null;

// Scene references (set during initialization)
let sceneRef: THREE.Scene | null = null;
let cameraRef: THREE.Camera | null = null;
let rendererRef: CandyRenderer | null = null;

export function initDeferredVisualsDependencies(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: CandyRenderer
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

    // Arm the GPU compute library in the background so the GPU foliage passes
    // (foliage-gpu-batch, gpu-plant-pose) find a warm device on first use.
    // Resolves silently when WebGPU is unavailable; CPU/WASM fallbacks stay active.
    void import('../compute/compute-init.ts')
        .then(({ initGPUCompute }) => {
            initGPUCompute();
            return import('../compute/compute-orchestrator.ts');
        })
        .then(({ ensureGpuComputeReady }) => {
            void ensureGpuComputeReady().then(async () => {
                const { initGpuFoliageOrchestrator } =
                    await import('../compute/gpu-foliage-orchestrator.ts');
                void initGpuFoliageOrchestrator();
            });
        });

    // Prefetch gameplay chunk in parallel with visual init (#1361)
    void preloadGameplay().then((gp) => {
        if (!sceneRef) return;
        if (gp.jitterMineSystem.mesh && !gp.jitterMineSystem.mesh.parent) {
            sceneRef.add(gp.jitterMineSystem.mesh);
            log.info('Deferred', 'Jitter Mine System initialized');
        }
        gp.chordStrikeSystem.addToScene(sceneRef);
        if (!harpoonLine) {
            harpoonLine = gp.createHarpoonLine();
            sceneRef.add(harpoonLine);
            log.info('Deferred', 'Harpoon Line initialized');
        }
    });

    if (FEATURE_FLAGS.awakenedPersistence) {
        initAwakenedPersistenceIfNeeded();
    }

    console.time('Deferred Visuals Init');

    // Group 1: Environmental effects (order matters for layering)
    console.time('Environmental Effects');
    const deferredCaps = getStartupCapabilities().deferred;

    if (deferredCaps.fluidFog && !fluidFog) {
        fluidFog = createFluidFog(200, 200); // 200x200 patch at center
        sceneRef.add(fluidFog);
        log.info('Deferred', 'Fluid Fog initialized');
    }

    if (deferredCaps.aurora && !aurora) {
        aurora = createAurora();
        sceneRef.add(aurora);
        harmonyOrbSystem.addToScene(sceneRef); // Add Harmony Orbs
        log.info('Deferred', 'Aurora & Systems initialized');
    }

    // WebGPU HDR post uses rgba16float. Camera overlays that call
    // viewportSharedTexture() copy into a default rgba8unorm FramebufferTexture
    // and fail CopyTextureToTexture validation. Pulses live in the TSL post
    // graph instead; keep overlays on the GLSL node backend only.
    const useViewportPulseOverlays = Boolean(
        rendererRef && isWebGLNodeBackend(rendererRef)
    );

    if (deferredCaps.aurora && !chromaticPulse && useViewportPulseOverlays) {
        chromaticPulse = createChromaticPulse();
        cameraRef.add(chromaticPulse);
        log.info('Deferred', 'Chromatic Pulse overlay initialized (WebGL)');
    }

    if (deferredCaps.aurora && !strobePulse && useViewportPulseOverlays) {
        strobePulse = createStrobePulse();
        cameraRef.add(strobePulse);
        log.info('Deferred', 'Strobe Pulse overlay initialized (WebGL)');
    }
    console.timeEnd('Environmental Effects');

    // Group 2: Celestial and world elements
    console.time('Celestial Elements');
    if (!celestialBodiesInitialized) {
        initCelestialBodies(sceneRef);
        celestialBodiesInitialized = true;
        log.info('Deferred', 'Celestial bodies initialized');
    }
    console.timeEnd('Celestial Elements');

    // Group 3: Interactive musical elements
    console.time('Musical Elements');
    if (!melodyRibbon) {
        melodyRibbon = createMelodyRibbon(sceneRef);
        log.info('Deferred', 'Melody Ribbon initialized');
    }

    if (!sparkleTrail) {
        sparkleTrail = createSparkleTrail();
        sceneRef.add(sparkleTrail);
        log.info('Deferred', 'Sparkle Trail initialized');
    }

    if (!impactSystem) {
        impactSystem = createImpactSystem();
        sceneRef.add(impactSystem);
        log.info('Deferred', 'Impact System initialized');
    }

    if (!dandelionSeedSystem) {
        dandelionSeedSystem = createDandelionSeedSystem();
        sceneRef.add(dandelionSeedSystem);
        log.info('Deferred', 'Dandelion Seed System initialized');
    }

    if (!discoveryEffect) {
        discoveryEffect = createDiscoveryEffect();
        sceneRef.add(discoveryEffect.mesh);
        log.info('Deferred', 'Discovery Effect initialized');

        // Export to global for easy triggering from discovery-optimized.ts
        (window as Window & { triggerDiscoveryEffect?: (position: THREE.Vector3) => void }).triggerDiscoveryEffect = (position: THREE.Vector3) => {
            if (discoveryEffect && discoveryEffect.trigger) {
                // Ensure we use the current global shader time
                discoveryEffect.trigger(position, uTime.value);
            }
        };
    }

    // Gameplay meshes (jitter / harpoon / chord) attach via preloadGameplay() above
    console.timeEnd('Musical Elements');

    console.timeEnd('Deferred Visuals Init');
}

/**
 * Apply persisted awakened glow to batchers after world entities are placed.
 * Called once post-populateWorld — O(awakened) GPU upload, no scene traversal.
 */
export function applyAwakenedPersistenceAfterWorldLoad(): void {
    if (!FEATURE_FLAGS.awakenedPersistence) return;
    void import('../systems/awakened-persistence.ts').then((m) => {
        m.getAwakenedStore()?.reconcileAndApplyToBatchers();
    });
}

// --- DEFERRED INCREMENTAL SHADER WARMUP ---
// Runs 2 seconds after world generation and compiles the generated world with
// `renderer.compileAsync()` in chunks (rendering/shader-warmup.ts), so the
// pipelines the next frames need already exist and no task blocks for long.
// Objects the boot pass already compiled are skipped, so nothing compiles twice.

/** Set to true to cancel an in-progress deferred warmup (e.g. on scene transition). */
let _warmupAborted = false;

/** Cancel any in-progress deferred shader warmup. */
export function abortWarmup(): void {
    _warmupAborted = true;
}

export function runDeferredWarmup(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: CandyRenderer,
    compileTarget?: (() => CompileTarget | null) | null
) {
    _warmupAborted = false;

    setTimeout(async () => {
        startPhase('Shader Warmup');
        performance.mark('candy:shader-warmup-start');
        log.info('Deferred', 'Starting incremental shader pre-compilation...');

        // Check CI and instant-boot bypass here
        if (
            isAutomation() ||
            (typeof window !== 'undefined' && window.__bootInstant === true)
        ) {
            log.info(
                'Deferred',
                'Skipping incremental shader pre-compilation in CI / instant-boot mode to prevent WebGPU Device Lost or dev stalls'
            );
            endPhase('Shader Warmup');
            return;
        }

        // Put the rainbow blaster's particle material in the scene so it compiles too.
        const dummyOrigin = new THREE.Vector3(0, -9999, 0);
        const dummyDir = new THREE.Vector3(0, 1, 0);
        const gp = await ensureGameplay();
        gp.fireRainbow(scene, dummyOrigin, dummyDir);

        let warmupBatches = 0;
        let warmupBatchMaxMs = 0;

        try {
            const { compileSceneProgressively } = await import('../rendering/shader-warmup.ts');
            const stats = await compileSceneProgressively(renderer, scene, camera, {
                target: compileTarget ?? null,
                shouldAbort: () => _warmupAborted,
            });
            warmupBatches = stats.chunks;
            warmupBatchMaxMs = stats.maxChunkMs;

            log.info(
                'Deferred',
                `✅ Scene shaders pre-compiled (${stats.objects} objects, ${stats.alreadyCompiled} from boot, ${warmupBatches} chunk${warmupBatches !== 1 ? 's' : ''}, ` +
                    `max ${warmupBatchMaxMs.toFixed(0)} ms/chunk${stats.aborted ? ', aborted' : ''}).`
            );
        } catch (e) {
            console.warn('[Warmup] Shader compilation error:', e);
        }

        // Record warmup metrics for the startup profiler report.
        recordWarmupMetrics(warmupBatches, warmupBatchMaxMs);

        performance.mark('candy:shader-warmup-end');
        try {
            performance.measure(
                'candy:Shader Warmup',
                'candy:shader-warmup-start',
                'candy:shader-warmup-end'
            );
        } catch {
            /* ignore if marks were cleared */
        }

        log.info('Deferred', 'Shader compilation complete');
        endPhase('Shader Warmup');
    }, 2000); // 2-second delay lets the browser settle after initial load.
}

// Getters for deferred objects (used by game-loop)
export function getMelodyRibbon() {
    return melodyRibbon;
}
export function getSparkleTrail() {
    return sparkleTrail;
}
export function getImpactSystem() {
    return impactSystem;
}
export function getFluidFog() {
    return fluidFog;
}
export function getDandelionSeedSystem() {
    return dandelionSeedSystem;
}
export function getDiscoveryEffect() {
    return discoveryEffect;
}
export function getHarpoonLine() {
    return harpoonLine;
}
export function getAurora() {
    return aurora;
}
export function getChromaticPulse() {
    return chromaticPulse;
}
export function getStrobePulse() {
    return strobePulse;
}
export function getPlayerShieldMesh() {
    return playerShieldMesh;
}
export function setPlayerShieldMesh(mesh: THREE.Object3D | null) {
    playerShieldMesh = mesh;
}
