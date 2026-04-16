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
import { createHarpoonLine } from '../gameplay/harpoon-line.ts';
import { fireRainbow } from '../gameplay/rainbow-blaster.ts';
import { animatedFoliage } from '../world/state.ts';
import { getGroundHeight } from '../utils/wasm-loader.js';
import { forceFullSceneWarmup } from './init.js';
import { startPhase, endPhase } from '../utils/startup-profiler.ts';

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
        import('../gameplay/chord-strike.ts').then(({ chordStrikeSystem }) => {
            if (sceneRef) {
                chordStrikeSystem.addToScene(sceneRef);
            }
        });
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

    if (!jitterMineSystem.mesh.parent) {
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

// --- DEFERRED NUCLEAR WARMUP ---
// Delay this by 2 seconds to let the browser breathe after initial load
export function runDeferredWarmup(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: any
) {
    setTimeout(async () => {
        startPhase('Shader Warmup');
        console.log('[Deferred] Starting shader pre-compilation...');

        const dummyGroup = new THREE.Group();
        dummyGroup.position.set(0, -9999, 0);
        scene.add(dummyGroup);

        // CHANGE: Use simpler geometry to avoid "Vertex buffer count (11) exceeds limit"
        // The complex Flower/Mushroom geometries were triggering WebGPU hardware limits
        // during warmup, causing the pipeline creation to fail and crashing the renderer.
        const dummyGeo = new THREE.BoxGeometry(1, 1, 1);
        const dummyMat = new THREE.MeshStandardMaterial({ color: 0xff00ff });
        const dummyMesh = new THREE.Mesh(dummyGeo, dummyMat);

        // We can add dummyMesh to represent generic standard materials
        dummyGroup.add(dummyMesh);

        // Keep the rainbow blaster warmup as it likely uses a different material system
        const dummyOrigin = new THREE.Vector3(0, -9999, 0);
        const dummyDir = new THREE.Vector3(0, 1, 0);
        fireRainbow(scene, dummyOrigin, dummyDir);

        // FIX: Ensure clipping planes are defined before compilation
        // WebGPURenderer 0.171.0+ can crash in setupHardwareClipping if this is undefined
        // We UNCONDITIONALLY reset this to ensure safety.
        if (renderer.clippingPlanes === undefined || renderer.clippingPlanes === null) {
            renderer.clippingPlanes = [];
            renderer.localClippingEnabled = false;
            console.log('[Deferred] Re-applied clipping planes fix (Safety Force).');
        }

        try {
            // Async compile prevents blocking the main thread too hard
            await renderer.compileAsync(scene, camera);
            await forceFullSceneWarmup(renderer, scene, camera);
            console.log("✅ Scene shaders pre-compiled (Nuclear Warmup complete).");
        } catch (e) {
            console.warn("Shader compile error (Non-Fatal):", e);
        }

        scene.remove(dummyGroup);
        dummyGroup.traverse((child: THREE.Object3D) => {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach((m: THREE.Material) => m.dispose());
                } else {
                    (mesh.material as THREE.Material).dispose();
                }
            }
        });

        console.log('[Deferred] Shader compilation complete');
        endPhase('Shader Warmup');
    }, 2000); // 2 second delay
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
