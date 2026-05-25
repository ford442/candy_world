import * as THREE from 'three';
import { createIntegratedFireflies } from '../particles/index.ts';
import { initCollisionSystem } from '../utils/wasm-loader.js';
import {
    createSky, createStars, createMoon, createMushroom, createGlowingFlower,
    createFlower, createSubwooferLotus, createAccordionPalm, createFiberOpticWillow,
    createFloatingOrb, createSwingableVine, VineSwing, createPrismRoseBush,
    createStarflower, createVibratoViolet, createTremoloTulip, createKickDrumGeyser,
    createRainingCloud, createWaveformWater, initFallingBerries,
    initGrassSystem, addGrassInstance,
    createArpeggioFern, createPortamentoPine, createCymbalDandelion, createSnareTrap,
    createBubbleWillow, createHelixPlant, createBalloonBush,
    createPanningPad, createSilenceSpirit, createInstrumentShrine, createMelodyMirror,
    createRetriggerMushroom, createIsland, createCaveEntrance,
    createTerrainMaterial, createLuminousPlant, luminousPlantBatcher
} from '../foliage/index.ts';
import { generateCloudLayer } from '../foliage/procedural-sky.ts';
import { validateFoliageMaterials, foliageMaterials } from '../foliage/index.ts';
import { createWisteriaCluster } from '../foliage/wisteria-cluster.ts';
import { CONFIG } from '../core/config.ts';
import { generateGroundHeightmap } from './ground-heightmap.ts';
import { registerPhysicsCave } from '../systems/physics/index.js';
import { initDiscoveryForFoliage } from '../systems/discovery-optimized.ts';
import {
    animatedFoliage, cpuAnimatedFoliage, foliageGroup, foliageMushrooms,
    foliageClouds, foliageTrampolines, foliagePanningPads, foliageGeysers,
    foliageTraps, foliagePortamentoPines, vineSwings, foliageVineLadders, worldGroup
} from './state.ts';
import mapData from '../../assets/map.json';
import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import { updateProgress } from '../ui/index.ts';
import { recordGenerationChunk } from '../utils/startup-profiler.ts';
import { populateArpeggioGrove, populateLakeIsland, populateProceduralExtras } from './generation-decorators.ts';
import {
    DEFAULT_MAP_CHUNK_SIZE, ENTITY_BUDGET_MS, YIELD_ENTITY_BATCH_SIZE, PROCEDURAL_ENTITY_COUNT,
    obstaclesData, WeatherSystem, WorldObjects, WorldMode, MapEntity, WorldProgressCallback,
    getUnifiedGroundHeight, isPositionValid, isCriticalEntity, yieldControl, shouldLogYieldProgress
} from './generation-utils.ts';

// --- Scene Setup ---
export async function initWorld(scene: THREE.Scene, weatherSystem: WeatherSystem, loadContent: boolean = true): Promise<WorldObjects> {
    // 0. Pre-flight Check
    validateFoliageMaterials(foliageMaterials);

    // Sky, stars, moon (fast — no yield needed)
    const sky = createSky();
    scene.add(sky);

    const stars = createStars();
    scene.add(stars);

    const moon = createMoon();
    moon.position.set(-50, 60, -30); // High up
    scene.add(moon);

    // Ground - SHRUNK from 2000 to 400 for tighter feel
    let groundGeo: THREE.PlaneGeometry;
    let groundMat: THREE.Material;

    // Parse URL parameter for quick toggle
    const urlParams = new URLSearchParams(window.location.search);
    const forceGpuTerrain = urlParams.has('gpuTerrain');

    // Yield before the heavy terrain generation so the loading screen can paint.
    await yieldControl();

    if (CONFIG.terrain?.useGpuHeightmap || forceGpuTerrain) {
        console.log("[World] Using GPU Heightmap Displacement");

        const resolution = CONFIG.terrain?.heightmapResolution || 256;
        groundGeo = new THREE.PlaneGeometry(400, 400, resolution, resolution);

        // generateGroundHeightmap is now async and yields internally every 32 rows
        const startParams = performance.now();
        const { heightTexture, normalTexture } = await generateGroundHeightmap(400, resolution);
        console.log(`[World] Generated heightmap in ${(performance.now() - startParams).toFixed(2)}ms`);

        groundMat = createTerrainMaterial(CONFIG.colors.ground, {
            roughness: 0.9,
            bumpStrength: 0.15,
            noiseScale: 20.0
        }, heightTexture, normalTexture);

    } else {
        console.log("[World] Using CPU Vertex Displacement");

        groundGeo = new THREE.PlaneGeometry(400, 400, 128, 128);
        const posAttribute = groundGeo.attributes.position;
        const vertexCount = posAttribute.count;
        const cpuYieldEvery = 2000; // yield every ~2k vertices to stay responsive

        for (let i = 0; i < vertexCount; i++) {
            const x = posAttribute.getX(i);
            const y = posAttribute.getY(i); // Plane is on XY
            const zWorld = -y;

            // Use the Unified Height that accounts for the Lake
            const height = getUnifiedGroundHeight(x, zWorld);
            posAttribute.setZ(i, height);

            if (i % cpuYieldEvery === cpuYieldEvery - 1) {
                await yieldControl();
            }
        }

        groundGeo.computeVertexNormals();

        // Replaced MeshPhysicalMaterial with Audio-Reactive TSL Material
        groundMat = createTerrainMaterial(CONFIG.colors.ground, {
            roughness: 0.9,
            bumpStrength: 0.15,
            noiseScale: 20.0
        });
    }

    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // 2. Update fog colour for compact world.
    // scene.fogNode (set in init.ts) drives actual WebGPU rendering via TSL rangeFog.
    // Keep scene.fog as THREE.Fog (not FogExp2) so WeatherSystem's stale reference
    // stays valid and renderer code never has to read FogExp2.density.
    const fogColor = new THREE.Color(CONFIG.colors.fog || 0xFFC5D3);
    if (scene.fog instanceof THREE.Fog) {
        scene.fog.color.set(fogColor);
    }
    scene.background = fogColor;

    // Initialize Vegetation Systems (yield first so browser can breathe)
    await yieldControl();
    initGrassSystem(scene, 10000);

    // Use CPU fallback for fireflies during startup. GPU compute init is async but can hang
    // on systems with partial WebGPU support; the CPU path is safe and fast enough for 150 particles.
    scene.add(createIntegratedFireflies({ count: 150, areaSize: 100, useCompute: false }));

    // Procedural Cloud Layer (Background)
    await yieldControl();
    generateCloudLayer(scene);

    // Melody Lake (Waveform Water)
    // Lake is at 20, 1.5, 20 with width 120, depth 100
    const melodyLake = createWaveformWater(120, 100);
    melodyLake.position.set(20, 1.5, 20);
    scene.add(melodyLake);

    // Lake Island
    const island = createIsland({ radius: 15, height: 2 });
    island.position.set(-40, 2.5, 40); // Place in the lake
    island.userData.type = 'lake_island';
    safeAddFoliage(island, true, 15, weatherSystem);

    // Add Luminous Plants around Lake Island (yield every 30 plants to stay responsive)
    const luminousCount = CONFIG.luminousPlants.density;
    await yieldControl();
    for (let i = 0; i < luminousCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        // Gentle radius falloff: more dense near edge (10-25), tapering out to 35
        // Using a square-root or quadratic distribution helps achieve this
        const randDist = Math.pow(Math.random(), 2.0); // more values near 0
        const dist = 10 + randDist * 25; // 10 to 35

        const lx = -40 + Math.cos(angle) * dist;
        const lz = 40 + Math.sin(angle) * dist;
        const ly = getUnifiedGroundHeight(lx, lz);

        // Quick biome check to avoid candy cane forest (let's say candy cane is where x > 0)
        // If x > 0, we'll just skip (assume biome boundary)
        if (lx > -10) continue;

        // Add a small height bias: prefer elevated ground
        // Don't spawn directly in water (y < 2.0) and favor y between 2.0 and 5.0
        if (ly > 2.0 && ly < 8.0) {
            const plant = createLuminousPlant({ scale: 0.8 + Math.random() * 0.6 });
            plant.position.set(lx, ly, lz);
            plant.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(plant, false, 0, weatherSystem);
        }

        if (i % 30 === 29) await yieldControl();
    }

    // Falling Berries
    await yieldControl();
    initFallingBerries(scene);

    // Add the luminous plant batcher to the scene
    scene.add(luminousPlantBatcher.mesh);

    // Add the main world group (containing all generated foliage) to the scene
    scene.add(worldGroup);

    // Generate Content if requested (triggered by start button in main.ts)
    if (loadContent) {
        generateMap(weatherSystem).catch(err => {
            console.error('[World] Failed to generate map:', err);
        });
    }

    return { sky, moon, ground };
}

// Ensure the lake island is also present
export function safeAddFoliage(
    obj: THREE.Object3D,
    isObstacle: boolean = false,
    radius: number = 1.0,
    weatherSystem: WeatherSystem | null = null
): void {
    if (animatedFoliage.length > 3000) return; // ⚡ PERFORMANCE: Raised limit from 1000 to 3000 for more musical objects
    foliageGroup.add(obj);
    animatedFoliage.push(obj);

    if (!(obj.userData.isBatched ||
        obj.userData.type === 'mushroom' ||
        obj.userData.type === 'lanternFlower' ||
        obj.userData.type === 'arpeggio_fern' ||
        obj.userData.type === 'portamento_pine' ||
        obj.userData.type === 'prismRoseBush' ||
        obj.userData.isFlower)) {
        cpuAnimatedFoliage.push(obj);
    }

    // Add to JS obstacles (legacy/backup)
    if (isObstacle) {
        // obstacles.push({ position: obj.position.clone(), radius }); // Replaced by obstaclesData

        // ⚡ OPTIMIZATION: Add to WASM Spatial Grid for O(1) validity checks later in batch
        // Type 5 = Generic Obstacle (Radius Check Only)
        obstaclesData.push({ x: obj.position.x, y: obj.position.y, z: obj.position.z, radius });
    }

    // Optimization
    if (obj.userData.type === 'mushroom') foliageMushrooms.push(obj);
    if (obj.userData.type === 'cloud') foliageClouds.push(obj);
    if (obj.userData.isTrampoline) foliageTrampolines.push(obj);
    if (obj.userData.type === 'panningPad') foliagePanningPads.push(obj);
    if (obj.userData.type === 'geyser') foliageGeysers.push(obj);
    if (obj.userData.type === 'trap') {
        foliageTraps.push(obj);
        console.log('[World] Registered Snare Trap. Total:', foliageTraps.length);
    }
    if (obj.userData.type === 'tree' && obj.userData.animationType === 'batchedPortamento') {
        foliagePortamentoPines.push(obj);
    }
    if (obj.userData.type === 'vine_ladder') foliageVineLadders.push(obj);

    // Invoke deferred placement logic (e.g. for batching)
    if (obj.userData.onPlacement) {
        obj.userData.onPlacement();
    }

    // Register with weather system
    if (weatherSystem) {
        if (obj.userData.type === 'tree') {
            weatherSystem.registerTree(obj);
        } else if (obj.userData.type === 'shrub') {
            weatherSystem.registerShrub(obj);
        } else if (obj.userData.type === 'mushroom') {
            weatherSystem.registerMushroom(obj);
        } else if (obj.userData.type === 'cave') {
            weatherSystem.registerCave(obj);
            registerPhysicsCave(obj);
        }
    }
}

export async function generateMap(
    weatherSystem: WeatherSystem,
    chunkSize: number = DEFAULT_MAP_CHUNK_SIZE,
    onProgress?: WorldProgressCallback
): Promise<void> {
    performance.mark('candy:map-generation-start');
    console.time('[World] generateMap total');
    console.log(`[World] Loading map with ${mapData.entities.length} entities...`);

    // Reset WASM Collision System for Generation Phase
    initCollisionSystem();

    const entities = mapData.entities as any as MapEntity[];

    // 1. Filter into Critical vs Deferred
    console.time('[World] entity-scan');
    const criticalEntities: MapEntity[] = [];
    const deferredEntities: MapEntity[] = [];

    let scannedEntities = 0;
    for (const item of entities) {
        if (isCriticalEntity(item)) {
            criticalEntities.push(item);
        } else {
            deferredEntities.push(item);
        }

        scannedEntities++;
        if (scannedEntities % YIELD_ENTITY_BATCH_SIZE === 0 && scannedEntities < entities.length) {
            if (shouldLogYieldProgress(scannedEntities, entities.length)) {
                console.log(`[World] Yielding during entity scan at ${scannedEntities}/${entities.length} (last type: ${item.type})`);
            }
            await yieldControl();
        }
    }
    console.timeEnd('[World] entity-scan');

    console.log(`[World] Filtered map: ${criticalEntities.length} critical, ${deferredEntities.length} deferred.`);

    const criticalTotal = criticalEntities.length;
    // For progress, we only track critical + Arpeggio Grove (treated as 1 chunk) during the blocking phase
    // Procedural extras are now split as well. We'll approximate.
    const globalTotal = criticalTotal + 1; // +1 for Arpeggio Grove

    // 2. Process Critical Map Entities with a per-entity time budget.
    // Instead of fixed-size chunks (which could still run long if entities are heavy),
    // we check elapsed time after each entity and yield as soon as ENTITY_BUDGET_MS
    // is exceeded. This keeps every task well under 100 ms.
    console.time('[World] critical-entities');
    let i = 0;
    while (i < criticalTotal) {
        const chunkStart = performance.now();
        let processed = 0;
        let lastEntityType = 'entity';

        while (i + processed < criticalTotal) {
            const idx = i + processed;
            const entity = criticalEntities[idx];
            lastEntityType = entity.type;
            processMapEntity(entity, weatherSystem);
            processed++;

            // Granular progress update every 50 entities with detailed text
            if ((i + processed) % 50 === 0) {
                const percentage = Math.floor(((i + processed) / criticalTotal) * 100);
                updateProgress('map-generation', percentage, `Spawning flora: ${i + processed}/${criticalTotal}`);
            }

            // Yield as soon as we've spent our per-chunk budget.
            if (processed >= YIELD_ENTITY_BATCH_SIZE || performance.now() - chunkStart >= ENTITY_BUDGET_MS) {
                break;
            }
        }

        i += processed;

        if (onProgress) {
            const current = Math.min(i, criticalTotal);
            onProgress(
                current,
                globalTotal,
                `[World] Populating world ${current}/${criticalTotal}`,
                lastEntityType
            );
        }

        // Record this chunk for the startup profiler.
        recordGenerationChunk();

        // Yield control back to the browser.
        if (i < criticalTotal) {
            if (shouldLogYieldProgress(i, criticalTotal)) {
                console.log(`[World] Yielding after ${i}/${criticalTotal} critical entities (last type: ${lastEntityType})`);
            }
            await yieldControl();
        }
    }
    console.timeEnd('[World] critical-entities');

    // --- Spawn The Cave (Critical) ---
    console.time('[World] cave-spawn');
    const cave = createCaveEntrance({ scale: 2.0 });
    const caveX = 25;
    const caveZ = 25;
    const caveY = getUnifiedGroundHeight(caveX, caveZ);
    cave.position.set(caveX, caveY, caveZ);
    cave.lookAt(0, caveY, 0);
    safeAddFoliage(cave, false, 0, weatherSystem);
    console.log("[World] Cave spawned at ", caveX, caveZ, " Height:", caveY);
    console.timeEnd('[World] cave-spawn');

    if (cave.userData.gatePosition) {
        const waterfallProxy = new THREE.Object3D();
        cave.updateMatrixWorld(true);
        waterfallProxy.position.copy(cave.userData.gatePosition).applyMatrix4(cave.matrixWorld);
        waterfallProxy.userData.type = 'waterfall';
        animatedFoliage.push(waterfallProxy as any);
    }

    // --- Populate Arpeggio Grove Set Piece (Critical) ---
    console.time('[World] arpeggio-grove');
    await populateArpeggioGrove(weatherSystem);
    console.timeEnd('[World] arpeggio-grove');
    if (onProgress) {
        onProgress(globalTotal, globalTotal, '[World] Critical full world population complete', 'arpeggio_grove');
    }

    // --- Initialize Discovery System with Spatial Grid (Critical) ---
    // OPTIMIZATION: O(1) spatial lookups instead of O(N) distance checks
    // We do this NOW before deferring the rest, so grids are static and complete for interactive items
    console.time('[World] discovery-init');
    initDiscoveryForFoliage(animatedFoliage);
    console.timeEnd('[World] discovery-init');

    // 3. Queue Deferred Map Entities
    console.time('[World] queue-deferred');
    console.log(`[World] Queueing ${deferredEntities.length} deferred map entities for background processing...`);
    let queuedDeferred = 0;
    for (const item of deferredEntities) {
        globalBackgroundProcessor.enqueue({
            id: `map_deferred_${item.type}`,
            execute: () => processMapEntity(item, weatherSystem)
        });

        queuedDeferred++;
        if (queuedDeferred % YIELD_ENTITY_BATCH_SIZE === 0 && queuedDeferred < deferredEntities.length) {
            if (shouldLogYieldProgress(queuedDeferred, deferredEntities.length)) {
                console.log(`[World] Yielding while queueing deferred entities at ${queuedDeferred}/${deferredEntities.length} (last type: ${item.type})`);
            }
            await yieldControl();
        }
    }
    console.timeEnd('[World] queue-deferred');

    // --- Populate Procedural Extras (Split into Critical/Deferred inside) ---
    console.time('[World] procedural-extras');
    await populateProceduralExtras(weatherSystem, chunkSize);
    console.timeEnd('[World] procedural-extras');

    performance.mark('candy:map-generation-end');
    try {
        performance.measure('candy:Map Generation', 'candy:map-generation-start', 'candy:map-generation-end');
    } catch (_e) { /* ignore if marks were cleared */ }

    console.timeEnd('[World] generateMap total');
    console.log("[World] Critical map generation complete! Deferred tasks queued.");
}

export async function generateCoreWorld(
    weatherSystem: WeatherSystem,
    onProgress?: WorldProgressCallback
): Promise<void> {
    console.log('[World] Core Only mode: generating lightweight candy landscape');
    initCollisionSystem();

    const areaSize = 120;
    const maxAttempts = 20;
    const getRandomGroundPosition = (radius: number) => {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const x = (Math.random() - 0.5) * areaSize;
            const z = (Math.random() - 0.5) * areaSize;
            if (!isPositionValid(x, z, radius)) continue;
            return { x, z, y: getUnifiedGroundHeight(x, z) };
        }
        return null;
    };

    if (onProgress) onProgress(0, 4, '[World] Generating core world');

    // Basic candy trees — yield every ENTITY_BUDGET_MS to avoid blocking the main thread.
    // Tree geometry creation can take 10–30 ms each; without yielding 18 trees back-to-back
    // would stall the browser for up to 540 ms and trigger "Page Unresponsive".
    const treeFactories = [
        () => createBubbleWillow(),
        () => createBalloonBush(),
        () => createHelixPlant(),
        () => createPortamentoPine({ height: 4.5 }),
    ];
    let chunkStart = performance.now();
    for (let i = 0; i < 18; i++) {
        const factory = treeFactories[i % treeFactories.length];
        const pos = getRandomGroundPosition(1.5);
        if (pos) {
            const obj = factory();
            obj.position.set(pos.x, pos.y, pos.z);
            obj.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(obj, true, 1.5, weatherSystem);
        }
        if (performance.now() - chunkStart >= ENTITY_BUDGET_MS) {
            await yieldControl();
            chunkStart = performance.now();
        }
    }
    if (onProgress) onProgress(1, 4, '[World] Core trees ready', 'tree');

    // Mushrooms and ground accents — same time-based yield approach.
    chunkStart = performance.now();
    for (let i = 0; i < 24; i++) {
        const pos = getRandomGroundPosition(0.5);
        if (pos) {
            const obj = createMushroom({ size: 'regular', scale: 0.8 + Math.random() * 0.5, hasFace: true, isBouncy: true });
            obj.position.set(pos.x, pos.y, pos.z);
            obj.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(obj, true, 0.5, weatherSystem);
        }
        if (performance.now() - chunkStart >= ENTITY_BUDGET_MS) {
            await yieldControl();
            chunkStart = performance.now();
        }
    }
    if (onProgress) onProgress(2, 4, '[World] Core mushrooms ready', 'mushroom');

    // Clouds above the terrain.
    chunkStart = performance.now();
    for (let i = 0; i < 12; i++) {
        const pos = getRandomGroundPosition(0.8);
        if (!pos) continue;
        const height = 10 + Math.random() * 18;
        const cloud = createRainingCloud({ size: 1.0 + Math.random() * 0.8 });
        cloud.position.set(pos.x, height, pos.z);
        cloud.userData.tier = 1;
        cloud.userData.isWalkable = true;
        safeAddFoliage(cloud, false, 0.8, weatherSystem);
        if (performance.now() - chunkStart >= ENTITY_BUDGET_MS) {
            await yieldControl();
            chunkStart = performance.now();
        }
    }
    if (onProgress) onProgress(3, 4, '[World] Core clouds ready', 'cloud');

    // Low flowers and luminous accents (lightweight — single yield at end is sufficient).
    for (let i = 0; i < 16; i++) {
        const factory = Math.random() < 0.5 ? () => createFlower() : () => createGlowingFlower();
        const pos = getRandomGroundPosition(0.4);
        if (pos) {
            const obj = factory();
            obj.position.set(pos.x, pos.y, pos.z);
            obj.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(obj, false, 0.4, weatherSystem);
        }
    }
    await yieldControl();

    // Lake island accents.
    const islandItems = [
        () => createGlowingFlower(),
        () => createFlower(),
    ];
    for (let i = 0; i < 8; i++) {
        const pos = getRandomGroundPosition(0.4);
        if (!pos) continue;
        const factory = islandItems[i % islandItems.length];
        const obj = factory();
        obj.position.set(pos.x, pos.y, pos.z);
        obj.rotation.y = Math.random() * Math.PI * 2;
        safeAddFoliage(obj, false, 0.4, weatherSystem);
    }

    initDiscoveryForFoliage(animatedFoliage);
    if (onProgress) onProgress(4, 4, '[World] Core world population complete', 'flower');
    console.log(`[World] Core Only world generation complete. Spawned ${animatedFoliage.length} objects.`);
}

export async function populateWorld(
    scene: THREE.Scene,
    weatherSystem: WeatherSystem,
    mode: WorldMode = 'CORE',
    onProgress?: WorldProgressCallback
): Promise<WorldMode> {
    console.log(`[World] Starting populateWorld() in ${mode} mode`);

    if (mode === 'CORE') {
        console.log('%c[World] CORE Mode active — spawning minimal classic candy set', 'color:#ff9ecd');
        console.log('[World] Core mode skips: map entities, arpeggio grove, procedural extras, WASM physics upload');
        await generateCoreWorld(weatherSystem, onProgress);
        console.log('[World] Core mode ready. Heavy foliage systems skipped.');
        console.log('[World] populateWorld() complete in CORE mode');
        return 'CORE';
    }

    console.log('%c[World] FULL Mode — attempting complete musical ecosystem', 'color:#7dd3fc');
    console.log(`[World] Full mode: ${(mapData as any).entities?.length ?? 0} map entities + ${PROCEDURAL_ENTITY_COUNT} procedural extras to process`);
    try {
        await generateMap(weatherSystem, DEFAULT_MAP_CHUNK_SIZE, onProgress);
        console.log('[World] Full mode population complete.');
        console.log('[World] populateWorld() complete in FULL mode');
        return 'FULL';
    } catch (error) {
        console.error('[World] Full population failed. Falling back from FULL to CORE.', error);
        await generateCoreWorld(weatherSystem, onProgress);
        console.log('[World] populateWorld() recovered in CORE mode after FULL failure');
        return 'CORE';
    }
}

export /**
 * Process a single map entity (extracted from forEach loop for chunking)
 */
function processMapEntity(item: MapEntity, weatherSystem: WeatherSystem): void {
    const [x, yInput, z] = item.position;
    // USE UNIFIED HEIGHT for placement
    const groundY = getUnifiedGroundHeight(x, z);
    let y = groundY;
    if (item.type === 'cloud') y = yInput;

    try {
        let obj: THREE.Object3D | null = null;
        let isObstacle = false;
        let radius = 0.5;

        // --- Basic Types ---
        if (item.type === 'mushroom') {
                const isGiant = item.variant === 'giant';
                const scale = item.scale || 1.0;
                const hasFace = item.hasFace !== undefined ? item.hasFace : (isGiant || Math.random() < 0.1);
                const isBouncy = isGiant || hasFace;

                obj = createMushroom({
                    size: isGiant ? 'giant' : 'regular',
                    scale,
                    hasFace,
                    isBouncy,
                    note: item.note,
                    noteIndex: item.noteIndex
                });
                isObstacle = true;
                radius = isGiant ? 2.0 : 0.5;
            }
        else if (item.type === 'flower') {
            const isGlowing = item.variant === 'glowing';
            obj = isGlowing ? createGlowingFlower() : createFlower();
        }
        else if (item.type === 'cloud') {
            const cloudTier = (item as any).tier || 1;
            obj = createRainingCloud({ size: item.size as number || 1.5 });
            obj.userData.tier = cloudTier;
            obj.userData.isWalkable = cloudTier === 1;
        }
        else if (item.type === 'grass') {
            addGrassInstance(x, y, z);
            return;
        }
        // ... (Other types elided for brevity, same logic follows) ...
        else if (item.type === 'subwoofer_lotus') {
            obj = createSubwooferLotus({ scale: item.scale || 1.0 });
        }
        else if (item.type === 'accordion_palm') {
            obj = createAccordionPalm({ color: 0xFFD700 });
            isObstacle = true;
        }
        else if (item.type === 'fiber_optic_willow') {
            obj = createFiberOpticWillow();
            isObstacle = true;
        }
        else if (item.type === 'floating_orb') {
            obj = createFloatingOrb({ size: 0.5 });
            y += 1.5;
        }
        else if (item.type === 'swingable_vine') {
            obj = createSwingableVine({ length: 8 });
            y += 8;
            if (vineSwings) vineSwings.push(new VineSwing(obj, 8));
        }
        else if (item.type === 'prism_rose_bush') {
            obj = createPrismRoseBush();
            isObstacle = true;
        }
        else if (item.type === 'starflower') {
            obj = createStarflower();
        }
        else if (item.type === 'vibrato_violet') {
            obj = createVibratoViolet();
        }
        else if (item.type === 'tremolo_tulip') {
            obj = createTremoloTulip();
        }
        else if (item.type === 'kick_drum_geyser') {
            obj = createKickDrumGeyser();
        }
        // Musical Flora
        else if (item.type === 'arpeggio_fern') {
            obj = createArpeggioFern({ scale: item.scale || 1.0 });
        }
        else if (item.type === 'portamento_pine') {
            obj = createPortamentoPine({ height: 4.0 });
            isObstacle = true;
        }
        else if (item.type === 'cymbal_dandelion') {
            obj = createCymbalDandelion();
        }
        else if (item.type === 'snare_trap') {
            obj = createSnareTrap();
        }
        else if (item.type === 'retrigger_mushroom') {
            obj = createRetriggerMushroom({ scale: item.scale || 1.0 });
        }
        else if (item.type === 'panning_pad') {
            const panBias = x < 0 ? -1 : 1;
            obj = createPanningPad({ radius: item.scale || 1.0, panBias: panBias });
            if (y < 2) y = 1.0;
        }
        // Spirits
        else if (item.type === 'silence_spirit') {
            obj = createSilenceSpirit({ scale: item.scale || 1.0 });
        }
        // Instrument Shrines
        else if (item.type === 'instrument_shrine') {
            const id = parseInt(item.variant || '0', 10);
            obj = createInstrumentShrine({ instrumentID: id, scale: item.scale || 1.0 });
            isObstacle = true;
            radius = 1.0;
        }
        // Trees
        else if (item.type === 'bubble_willow') {
            obj = createBubbleWillow();
            isObstacle = true;
        }
        else if (item.type === 'helix_plant') {
            obj = createHelixPlant();
        }
        else if (item.type === 'balloon_bush') {
            obj = createBalloonBush();
        }
        else if (item.type === 'wisteria_cluster') {
            obj = createWisteriaCluster();
            y += 4;
        }

        // --- Spawning ---
        if (obj) {
            obj.position.set(x, y, z);
            obj.rotation.y = Math.random() * Math.PI * 2;
            if (item.scale && item.type !== 'mushroom' && item.type !== 'flower') {
                obj.scale.setScalar(item.scale);
            }
            safeAddFoliage(obj, isObstacle, radius, weatherSystem);
        }

    } catch (e) {
        console.warn(`[World] Failed to spawn ${item.type} at ${x},${z}`, e);
    }
}

// Compatibility wrappers for refactored startup flow
export async function initCriticalWorld(scene: THREE.Scene, weatherSystem?: WeatherSystem): Promise<WorldObjects> {
    if (!weatherSystem) throw new Error('[World] initCriticalWorld: weatherSystem is required');
    return initWorld(scene, weatherSystem, false);
}

export async function initWorldCritical(scene: THREE.Scene, weatherSystem?: WeatherSystem): Promise<WorldObjects> {
    if (!weatherSystem) throw new Error('[World] initWorldCritical: weatherSystem is required');
    return initWorld(scene, weatherSystem, false);
}

export async function initDeferredWorldContent(
    scene: THREE.Scene,
    weatherSystem: WeatherSystem,
    onProgress?: (percent: number, label: string) => void
): Promise<void> {
    // Background deferred loading - map generation is triggered separately on enter
    if (onProgress) onProgress(100, 'Deferred content ready');
}

export function initWorldContent(scene: THREE.Scene, weatherSystem: WeatherSystem): Promise<void> {
    return initDeferredWorldContent(scene, weatherSystem);
}
