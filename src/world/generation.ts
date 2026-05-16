// src/world/generation.ts
import { updateProgress } from '../ui/index.ts';
import { createIntegratedFireflies, createIntegratedPollen, createIntegratedSparks, registerIntegratedSystem } from '../particles/index.ts';
import * as THREE from 'three';
import { getGroundHeight, batchGroundHeight, initCollisionSystem, addCollisionObject, checkPositionValidity } from '../utils/wasm-loader.js';
import {
    createSky, createStars, createMoon, createMushroom, createGlowingFlower,
    createFlower, createSubwooferLotus, createAccordionPalm, createFiberOpticWillow,
    createFloatingOrb, createSwingableVine, createVineLadder, VineSwing, createPrismRoseBush,
    createStarflower, createVibratoViolet, createTremoloTulip, createKickDrumGeyser,
    createRainingCloud, createWaveformWater, initFallingBerries,
    initGrassSystem, addGrassInstance,
    createArpeggioFern, createPortamentoPine, createCymbalDandelion, createSnareTrap,
    createBubbleWillow, createHelixPlant, createBalloonBush,
    createPanningPad, createSilenceSpirit, createInstrumentShrine, createMelodyMirror,
    createRetriggerMushroom, createIsland, createCaveEntrance,
    createTerrainMaterial, createLuminousPlant, LuminousPlantBatcher
} from '../foliage/index.ts';

import { generateCloudLayer } from '../foliage/procedural-sky.ts';
import { validateFoliageMaterials, foliageMaterials } from '../foliage/index.ts';
import { createWisteriaCluster } from '../foliage/wisteria-cluster.ts';
import { CONFIG } from '../core/config.ts';
import { generateGroundHeightmap, disposeHeightmap } from './ground-heightmap.ts';

import { registerPhysicsCave } from '../systems/physics/index.js';
import { initDiscoveryForFoliage } from '../systems/discovery-optimized.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { spawnImpact } from '../foliage/impacts.ts';
import { makeInteractive } from '../utils/interaction-utils.ts';

import {
    animatedFoliage, cpuAnimatedFoliage, foliageGroup, foliageMushrooms,
    foliageClouds, foliageTrampolines, foliagePanningPads, foliageGeysers,
    foliageTraps, foliagePortamentoPines, vineSwings, foliageVineLadders, worldGroup
} from './state.ts';

import mapData from '../../assets/map.json';

// ... (your constants: LAKE_BOUNDS, LAKE_ISLAND, ARPEGGIO_GROVE) ...

function applyLakeIslandModifier(x: number, z: number, baseHeight: number): number {
    let height = baseHeight;

    if (x > LAKE_BOUNDS.minX && x < LAKE_BOUNDS.maxX && 
        z > LAKE_BOUNDS.minZ && z < LAKE_BOUNDS.maxZ) {

        const distX = Math.min(x - LAKE_BOUNDS.minX, LAKE_BOUNDS.maxX - x);
        const distZ = Math.min(z - LAKE_BOUNDS.minZ, LAKE_BOUNDS.maxZ - z);
        const distEdge = Math.min(distX, distZ);

        // Island logic
        if (LAKE_ISLAND.enabled) {
            const dx = x - LAKE_ISLAND.centerX;
            const dz = z - LAKE_ISLAND.centerZ;
            const distFromIslandCenter = Math.sqrt(dx * dx + dz * dz);

            if (distFromIslandCenter < LAKE_ISLAND.radius) {
                const normalizedDist = distFromIslandCenter / LAKE_ISLAND.radius;
                const islandHeight = LAKE_ISLAND.peakHeight * Math.cos(normalizedDist * Math.PI / 2);
                const edgeBlend = Math.min(1.0, (LAKE_ISLAND.radius - distFromIslandCenter) / LAKE_ISLAND.falloffRadius);
                const waterLevel = 1.5;
                return Math.max(height, waterLevel + islandHeight * edgeBlend);
            }
        }

        // Lake depth falloff
        const normalizedDist = Math.min(1.0, distEdge / LAKE_BOUNDS.falloffDistance);
        const smoothFalloff = 0.5 - 0.5 * Math.cos(normalizedDist * Math.PI);
        const maxDepth = 2.0;
        const lakeBottom = height - maxDepth;
        height = height - (height - lakeBottom) * (1.0 - smoothFalloff);
    }

    return height;
}

export function getUnifiedGroundHeight(x: number, z: number): number {
    return applyLakeIslandModifier(x, z, getGroundHeight(x, z));
}

// ============== CRITICAL WORLD INIT ==============
// ============== CRITICAL WORLD INIT ==============
export function initCriticalWorld(scene: THREE.Scene, weatherSystem?: WeatherSystem): WorldObjects {
    validateFoliageMaterials(foliageMaterials);

    // Sky, Stars, Moon
    const sky = createSky();
    scene.add(sky);

    const stars = createStars();
    scene.add(stars);

    const moon = createMoon();
    moon.position.set(-50, 60, -30);
    scene.add(moon);

    // ==================== GROUND GENERATION ====================
    let groundGeo: THREE.PlaneGeometry;
    let groundMat: THREE.Material;

    const urlParams = new URLSearchParams(window.location.search);
    const forceGpuTerrain = urlParams.has('gpuTerrain');
    const useGpuHeightmap = CONFIG.terrain?.useGpuHeightmap || forceGpuTerrain;

    if (useGpuHeightmap) {
        console.log("[World] Using GPU Heightmap Displacement (Texture-based)");

        const resolution = CONFIG.terrain?.heightmapResolution || 256;
        groundGeo = new THREE.PlaneGeometry(400, 400, resolution, resolution);

        const startTime = performance.now();
        const { heightTexture, normalTexture } = generateGroundHeightmap(400, resolution);
        
        console.log(`[World] Generated heightmap textures in ${(performance.now() - startTime).toFixed(2)}ms`);

        groundMat = createTerrainMaterial(CONFIG.colors.ground, {
            roughness: 0.9,
            bumpStrength: 0.15,
            noiseScale: 20.0
        }, heightTexture, normalTexture);

    } else {
        console.log("[World] Using WASM Batched CPU Vertex Displacement");

        groundGeo = new THREE.PlaneGeometry(400, 400, 128, 128);
        const posAttribute = groundGeo.attributes.position as THREE.BufferAttribute;
        const vertexCount = posAttribute.count;

        // Prepare batch for WASM
        const coordinates = new Float32Array(vertexCount * 2);
        for (let i = 0; i < vertexCount; i++) {
            coordinates[i * 2]     = posAttribute.getX(i);
            coordinates[i * 2 + 1] = -posAttribute.getY(i);
        }

        const baseHeights = batchGroundHeight(coordinates);

        for (let i = 0; i < vertexCount; i++) {
            const x = coordinates[i * 2];
            const z = coordinates[i * 2 + 1];
            const height = applyLakeIslandModifier(x, z, baseHeights[i]);
            posAttribute.setZ(i, height || 0);
        }

        groundGeo.computeVertexNormals();

        groundMat = createTerrainMaterial(CONFIG.colors.ground, {
            roughness: 0.9,
            bumpStrength: 0.15,
            noiseScale: 20.0
        });
    }

    // Create and add ground
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Fog + Background
    const fogColor = new THREE.Color(CONFIG.colors.fog || 0xFFC5D3);
    if (scene.fog instanceof THREE.Fog) {
        scene.fog.color = fogColor;
        scene.fog.near = 10;
        scene.fog.far = 120;
    }
    scene.background = fogColor;

    scene.add(worldGroup);

    return { sky, moon, ground };
}

// ============== DEFERRED (ASYNC) CONTENT ==============
export async function initDeferredWorldContent(
    scene: THREE.Scene,
    weatherSystem: WeatherSystem,
    onProgress?: (percent: number, label: string) => void
): Promise<void> {
    // Grass
    onProgress?.(0, 'Growing grass...');
    initGrassSystem(scene, 5000);
    await yieldIdle();

    // Lake + Island
    onProgress?.(15, 'Creating lake...');
    const melodyLake = createWaveformWater(120, 100);
    melodyLake.position.set(20, 1.5, 20);
    scene.add(melodyLake);

    const island = createIsland({ radius: 15, height: 2 });
    island.position.set(-40, 2.5, 40);
    island.userData.type = 'lake_island';
    safeAddFoliage(island, true, 15, weatherSystem);
    await yieldIdle();

    // Clouds
    onProgress?.(30, 'Generating clouds...');
    generateCloudLayer(scene);
    await yieldIdle();

    // Luminous plants (chunked)
    onProgress?.(45, 'Planting flora...');
    const luminousCount = CONFIG.luminousPlants.density;
    const chunk = 30;
    for (let i = 0; i < luminousCount; i += chunk) {
        for (let j = i; j < Math.min(i + chunk, luminousCount); j++) {
            // ... your luminous plant spawning logic ...
        }
        onProgress?.(45 + Math.floor((i / luminousCount) * 35), 'Planting flora...');
        await yieldIdle();
    }

    // Fireflies + final systems
    onProgress?.(85, 'Spawning fireflies...');
    scene.add(createIntegratedFireflies({ count: 150, areaSize: 100, useCompute: true }));
    initFallingBerries(scene);
    scene.add(LuminousPlantBatcher.mesh);

    onProgress?.(100, 'World complete!');
}

export async function initWorld(
    scene: THREE.Scene,
    weatherSystem: WeatherSystem,
    loadContent = true
): Promise<WorldObjects> {
    const critical = initCriticalWorld(scene, weatherSystem);
    if (loadContent) {
        await initDeferredWorldContent(scene, weatherSystem);
        generateMap(weatherSystem).catch(console.error);
    }
    return critical;
}

// yieldIdle, safeAddFoliage, isPositionValid, generateMap, etc. stay as in your main branch
