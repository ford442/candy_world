import * as THREE from 'three';
import { createIntegratedFireflies } from '../particles/index.ts';
import { initCollisionSystem } from '../utils/wasm-loader.ts';
import {
    createSky, createStars, createMoon, createWaveformWater, initFallingBerries,
    initGrassSystem, addGrassInstance,
    createIsland, VineSwing,
    createTerrainMaterial, luminousPlantBatcher
} from '../foliage/index.ts';
import { generateCloudLayer } from '../foliage/procedural-sky.ts';
import { validateFoliageMaterials, foliageMaterials } from '../foliage/index.ts';
import { CONFIG, FEATURE_FLAGS } from '../core/config.ts';
import { generateGroundHeightmap } from './ground-heightmap.ts';
import { registerPhysicsCave } from '../systems/physics/index.js';
import { initDiscoveryForFoliage } from '../systems/discovery-optimized.ts';
import {
    animatedFoliage, cpuAnimatedFoliage, foliageGroup, foliageMushrooms,
    foliageClouds, foliageTrampolines, foliagePanningPads, foliageGeysers,
    foliageTraps, foliagePortamentoPines, vineSwings, foliageVineLadders, worldGroup
} from './state.ts';
import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import { recordSpawnAttempt, getReport, reset as resetSpawnTracker } from './spawn-tracker.ts';
import { updateProgress } from '../ui/index.ts';
import { endPhase, recordGenerationChunk, startPhase } from '../utils/startup-profiler.ts';
import { populateProceduralExtras, populateGemCanopyCorridor, populateMyceliumGrove } from './generation-decorators.ts';
import {
    DEFAULT_MAP_CHUNK_SIZE, ENTITY_BUDGET_MS, YIELD_ENTITY_BATCH_SIZE, PROCEDURAL_ENTITY_COUNT,
    obstaclesData, WeatherSystem, WorldObjects, WorldMode, MapEntity, WorldProgressCallback,
    getUnifiedGroundHeight, isPositionValid, yieldControl, normalizeMapEntityType
} from './generation-utils.ts';
import { getMapSourceFromUrl, loadMap, setupMapHotReload, type LoadedCandyMap } from './map-loader.ts';
import { clearMapMusicContext, deriveMapMusicContext, setMapMusicContext } from './map-music-context.ts';
import { create, getTypeMeta, registerBuiltinWorldObjectTypes, registerWorldObject } from './foliage-registry.ts';
import { treeBatcher } from '../foliage/tree-batcher.ts';
import { treeBatcher } from '../foliage/tree-batcher.ts';
import { subwooferLotusBatcher } from '../foliage/subwoofer-lotus-batcher.ts';

let loadedMapPromise: Promise<LoadedCandyMap> | null = null;

export let worldGenerationToken = 0;
registerBuiltinWorldObjectTypes();

const STREAMING_PRIORITY_TYPES = [
    'cave',
    'subwoofer_lotus',
    'instrument_shrine',
    'retrigger_mushroom',
    'portamento_pine',
    'bubble_willow',
    'mushroom',
    'cloud',
    'flower'
] as const;

const VISIBLE_BUBBLE_RADIUS = 80;
const VISIBLE_BUBBLE_LIMIT = 300;

function applyMapPreallocationHints(loadedMap: LoadedCandyMap): void {
    const expected = loadedMap.getExpectedInstanceCounts();
    const explicitTreeHint = expected.tree;
    const derivedTreeHint =
        (expected.bubble_willow ?? 0) +
        (expected.helix_plant ?? 0) +
        (expected.balloon_bush ?? 0) +
        (expected.accordion_palm ?? 0) +
        (expected.fiber_optic_willow ?? 0) +
        (expected.portamento_pine ?? 0) +
        (expected.prism_rose_bush ?? 0);
    const treeHint = Math.max(explicitTreeHint ?? 0, derivedTreeHint);
    if (treeHint > 0) {
        treeBatcher.setInitialCapacity(treeHint);
    }
}

function invalidateLoadedMap(): void {
    loadedMapPromise = null;
    clearMapMusicContext();
}

async function getLoadedMap(): Promise<LoadedCandyMap> {
    if (!loadedMapPromise) {
        const defaultSource = new URL('../../assets/map.json', import.meta.url).href;
        const source = getMapSourceFromUrl(defaultSource);
        loadedMapPromise = loadMap(source)
            .catch(async error => {
                if (source === defaultSource) throw error;
                console.warn(`[MapLoader] Failed to load "${source}", falling back to default map.`, error);
                return loadMap(defaultSource);
            })
            .then(loaded => {
                setMapMusicContext(deriveMapMusicContext(loaded.data));
                return loaded;
            });
    }
    return loadedMapPromise;
}

if (typeof window !== 'undefined') {
    setupMapHotReload(getMapSourceFromUrl('./assets/map.json'), () => {
        invalidateLoadedMap();
        console.log('[MapLoader] Map asset changed, cache invalidated.');
    });
}

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
    if (FEATURE_FLAGS.grass) {
        initGrassSystem(scene, 10000);
    }

    // Use CPU fallback for fireflies during startup. GPU compute init is async but can hang
    // on systems with partial WebGPU support; the CPU path is safe and fast enough for 150 particles.
    if (FEATURE_FLAGS.fireflies) {
        scene.add(createIntegratedFireflies({ count: 150, areaSize: 100, useCompute: false }));
    }

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
    if (FEATURE_FLAGS.luminousPlants) {
        const luminousCount = CONFIG.luminousPlants.density;
        await yieldControl();
        for (let i = 0; i < luminousCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const randDist = Math.pow(Math.random(), 2.0);
            const dist = 10 + randDist * 25;

            const lx = -40 + Math.cos(angle) * dist;
            const lz = 40 + Math.sin(angle) * dist;
            const ly = getUnifiedGroundHeight(lx, lz);

            if (lx > -10) continue;
            if (ly > 2.0 && ly < 8.0) {
                const plant = create('luminous_plant', { scale: 0.8 + Math.random() * 0.6 });
                if (!plant) continue;
                plant.position.set(lx, ly, lz);
                plant.rotation.y = Math.random() * Math.PI * 2;
                safeAddFoliage(plant, false, 0, weatherSystem);
            }

            if (i % 30 === 29) await yieldControl();
        }
        // Add the luminous plant batcher to the scene
        scene.add(luminousPlantBatcher.mesh);
    }

    // Falling Berries
    await yieldControl();
    initFallingBerries(scene);

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

const CPU_ANIMATION_LIMIT = 3000;
let _cpuLimitWarnedAt = 0;

// Returns true if the object was successfully added to the scene.
export function safeAddFoliage(
    obj: THREE.Object3D,
    isObstacle: boolean = false,
    radius: number = 1.0,
    weatherSystem: WeatherSystem | null = null
): boolean {
    const isBatched =
        obj.userData.isBatched ||
        obj.userData.type === 'mushroom' ||
        obj.userData.type === 'lanternFlower' ||
        obj.userData.type === 'arpeggio_fern' ||
        obj.userData.type === 'portamento_pine' ||
        obj.userData.type === 'gem_canopy_tree' ||
        obj.userData.type === 'glass_mushroom' ||
        obj.userData.type === 'prismRoseBush' ||
        obj.userData.isFlower;

    // CPU-animated objects are capped to keep the game-loop affordable.
    // Batcher-managed objects bypass this gate — their geometry lives in InstancedMesh,
    // not in per-frame CPU traversal, so they don't contribute to frame cost here.
    const cpuFull = !isBatched && cpuAnimatedFoliage.length >= CPU_ANIMATION_LIMIT;
    if (cpuFull) {
        if (cpuAnimatedFoliage.length > _cpuLimitWarnedAt + 100) {
            console.warn(`[World] CPU animation limit (${CPU_ANIMATION_LIMIT}) reached; non-batched objects will be skipped.`);
            _cpuLimitWarnedAt = cpuAnimatedFoliage.length;
        }
        return false;
    }

    foliageGroup.add(obj);
    animatedFoliage.push(obj);
    if (!isBatched) cpuAnimatedFoliage.push(obj);

    if (isObstacle) {
        obstaclesData.push({ x: obj.position.x, y: obj.position.y, z: obj.position.z, radius });
    }

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

    // Batcher registration — must not throw silently.
    if (obj.userData.onPlacement) {
        try {
            obj.userData.onPlacement();
        } catch (err) {
            const t = obj.userData.type ?? obj.userData.mapEntityType ?? 'unknown';
            console.error(`[World] onPlacement() failed for "${t}":`, err);
            recordSpawnAttempt(`${t}_batcher`, false, err);
        }
    }
    if (typeof obj.userData.mapEntityType === 'string') {
        registerWorldObject(obj, obj.userData.mapEntityType);
    } else if (typeof obj.userData.type === 'string') {
        registerWorldObject(obj, normalizeMapEntityType(obj.userData.type));
    }

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
    return true;
}

interface ProcessEntityOptions {
    streamed?: boolean;
}

function applyDreamyPopIn(obj: THREE.Object3D): void {
    const animatedMaterials: Array<{ mat: THREE.Material & { opacity: number; transparent: boolean }; targetOpacity: number }> = [];
    obj.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.material) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
            if (!(material as any).isMaterial || !('opacity' in material)) continue;
            const typed = material as THREE.Material & { opacity: number; transparent: boolean };
            if (typed.opacity >= 0.99) {
                typed.transparent = true;
                typed.opacity = 0;
                animatedMaterials.push({ mat: typed, targetOpacity: 1 });
            }
        }
    });

    if (animatedMaterials.length === 0) return;
    const start = performance.now();
    const duration = 380;
    const tick = () => {
        const elapsed = performance.now() - start;
        const t = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - t, 2);
        for (const entry of animatedMaterials) {
            entry.mat.opacity = entry.targetOpacity * eased;
            if (t >= 1) entry.mat.transparent = false;
        }
        if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

export async function generateMap(
    weatherSystem: WeatherSystem,
    chunkSize: number = DEFAULT_MAP_CHUNK_SIZE,
    onProgress?: WorldProgressCallback
): Promise<void> {
    worldGenerationToken = Date.now();
    (window as any).__currentWorldGenerationToken = worldGenerationToken;
    const generationToken = worldGenerationToken;
    resetSpawnTracker();
    performance.mark('candy:map-generation-start');
    console.time('[World] generateMap total');
    const loadedMap = await getLoadedMap();
    applyMapPreallocationHints(loadedMap);
    console.log(`[World] Loading map (${loadedMap.source}) with ${loadedMap.entities.length} entities...`);

    // Reset WASM Collision System for Generation Phase
    initCollisionSystem();

    const spawnedEntityIds = new Set<string>();
    const phase1Entities = loadedMap.getNearestEntities({
        origin: [0, 0, 0],
        radius: VISIBLE_BUBBLE_RADIUS,
        limit: VISIBLE_BUBBLE_LIMIT,
        priorityTypes: STREAMING_PRIORITY_TYPES,
    });
    const phase1Total = phase1Entities.length;
    const phase1YieldAt = Math.ceil(phase1Total / 2);
    console.log(`[World] Streaming phase 1: spawning ${phase1Total} entities within ${VISIBLE_BUBBLE_RADIUS}m.`);

    startPhase('Map Streaming Phase 1 (Visible)');
    console.time('[World] phase1-visible');
    for (let i = 0; i < phase1Total; i++) {
        const entity = phase1Entities[i];
        processMapEntity(entity, weatherSystem);
        spawnedEntityIds.add(entity.id);

        if ((i + 1) % 50 === 0) {
            const percentage = Math.floor(((i + 1) / Math.max(1, phase1Total)) * 100);
            updateProgress('map-generation', percentage, `Spawning visible bubble: ${i + 1}/${phase1Total}`);
        }
        if (onProgress) {
            onProgress(
                i + 1,
                phase1Total,
                `[World] Streaming visible bubble ${i + 1}/${phase1Total}`,
                entity.type
            );
        }
        if (i + 1 === phase1YieldAt && i + 1 < phase1Total) {
            recordGenerationChunk();
            await yieldControl();
        }
    }
    console.timeEnd('[World] phase1-visible');
    endPhase('Map Streaming Phase 1 (Visible)');
    {
        const r = getReport();
        if (r.failed > 0) {
            console.warn(`[World] Phase 1 spawn report: ${r.succeeded} ok, ${r.failed} failed`, r.failuresByType);
        } else if (r.attempted > 0) {
            console.log(`[World] Phase 1 spawn report: ${r.succeeded}/${r.attempted} ok`);
        }
    }

    // --- Initialize Discovery System with Spatial Grid (Critical) ---
    // OPTIMIZATION: O(1) spatial lookups instead of O(N) distance checks
    // We do this NOW before deferring the rest, so grids are static and complete for interactive items
    console.time('[World] discovery-init');
    initDiscoveryForFoliage(animatedFoliage);
    console.timeEnd('[World] discovery-init');

    // 2. Stream remaining entities in prioritized near-to-far chunks.
    startPhase('Map Streaming Phase 2 (Horizon)');
    console.time('[World] phase2-horizon-queue');
    let queuedDeferred = 0;
    let streamBatch = 0;
    for (const batch of loadedMap.streamEntitiesNear(
        [0, 0, 0],
        Number.POSITIVE_INFINITY,
        STREAMING_PRIORITY_TYPES,
        { ringSize: 36, chunkSize: 36, excludeIds: spawnedEntityIds }
    )) {
        const streamPriority = Math.max(1, 80 - streamBatch);
        for (const item of batch) {
            if (spawnedEntityIds.has(item.id)) continue;
            spawnedEntityIds.add(item.id);
            const queuedType = item.type;
            const queuedId = item.id;
            const taskToken = generationToken;
            const streamFlag = streamBatch > 0;
            globalBackgroundProcessor.enqueue({
                id: `map_stream_${queuedType}_${queuedId}`,
                priority: streamPriority,
                execute: () => {
                    const currentToken = (window as any).__currentWorldGenerationToken ?? 0;
                    if (taskToken !== -1 && taskToken !== currentToken && !(window as any).__IS_FULL_BOOT_TEST) {
                        console.warn(`[Generation] Map task obsoleted (token ${taskToken} !== ${currentToken})`);
                        return;
                    }
                    processMapEntity(item as MapEntity, weatherSystem, { streamed: streamFlag });
                }
            });
            queuedDeferred++;
        }

        streamBatch++;
        if (streamBatch % 2 === 0) {
            recordGenerationChunk();
            await yieldControl();
        }
    }
    endPhase('Map Streaming Phase 2 (Horizon)');
    console.timeEnd('[World] phase2-horizon-queue');
    console.log(`[World] Streaming phase 2 queued ${queuedDeferred} horizon entities.`);

    if (onProgress) {
        onProgress(phase1Total, phase1Total, '[World] Visible bubble ready');
    }

    // 3. Queue Procedural Extras
    console.time('[World] procedural-extras');
    await populateProceduralExtras(weatherSystem, generationToken, chunkSize);
    await populateGemCanopyCorridor(weatherSystem);
    await populateMyceliumGrove(weatherSystem);
    console.timeEnd('[World] procedural-extras');

    // Keep a lightweight final fallback for any entities excluded from the streaming query.
    let fallbackQueued = 0;
    for (const item of loadedMap.entities) {
        if (spawnedEntityIds.has(item.id)) continue;
        const taskToken = generationToken;
        globalBackgroundProcessor.enqueue({
            id: `map_fallback_${item.type}_${item.id}`,
            priority: 1,
            execute: () => {
                const currentToken = (window as any).__currentWorldGenerationToken ?? 0;
                if (taskToken !== -1 && taskToken !== currentToken && !(window as any).__IS_FULL_BOOT_TEST) {
                    console.warn(`[Generation] Map fallback task obsoleted (token ${taskToken} !== ${currentToken})`);
                    return;
                }
                processMapEntity(item as MapEntity, weatherSystem, { streamed: true });
            }
        });
        fallbackQueued++;
    }
    if (fallbackQueued > 0) {
        console.warn(`[World] Fallback queued ${fallbackQueued} entities not covered by streaming rings.`);
    }

    performance.mark('candy:map-generation-end');
    try {
        performance.measure('candy:Map Generation', 'candy:map-generation-start', 'candy:map-generation-end');
    } catch (_e) { /* ignore if marks were cleared */ }

    console.timeEnd('[World] generateMap total');
    console.log("[World] Map streaming bootstrap complete. Horizon tasks queued.");
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

    // --- Near-player "seed ring": spawn decorative items within ~16–30 units of the
    // player spawn (origin) so the world feels immediately populated right after the
    // loading screen hides.  These are purely visual (no physics obstacles) so the
    // 15-unit hard-exclusion zone for obstacles doesn't apply.  We place them at
    // evenly-spaced angles around the spawn point, alternating between an inner ring
    // (~18 units, even indices) and an outer ring (~26 units, odd indices) for visual
    // variety.  Using `i % seedFactories.length` keeps the loop safe if SEED_RING_COUNT
    // is ever changed independently of the factory list.
    const SEED_RING_COUNT = 8;
    const SEED_RING_INNER = 18;
    const SEED_RING_OUTER = 26;
    const seedFactories: Array<() => THREE.Object3D | null> = [
        () => create('flower'),
        () => create('flower', { variant: 'glowing' }),
        () => create('flower'),
        () => create('flower', { variant: 'glowing' }),
        () => create('arpeggio_fern', { scale: 1.0 }),
        () => create('flower'),
        () => create('flower', { variant: 'glowing' }),
        () => create('arpeggio_fern', { scale: 0.8 }),
    ];
    for (let i = 0; i < SEED_RING_COUNT; i++) {
        const angle = (i / SEED_RING_COUNT) * Math.PI * 2;
        // Even indices → inner ring; odd indices → outer ring for staggered depth.
        const ringRadius = SEED_RING_INNER + (i % 2) * (SEED_RING_OUTER - SEED_RING_INNER);
        const sx = Math.cos(angle) * ringRadius;
        const sz = Math.sin(angle) * ringRadius;
        const sy = getUnifiedGroundHeight(sx, sz);
        const seedObj = seedFactories[i % seedFactories.length]();
        if (!seedObj) continue;
        seedObj.position.set(sx, sy, sz);
        seedObj.rotation.y = Math.random() * Math.PI * 2;
        safeAddFoliage(seedObj, false, 0.3, weatherSystem);
    }
    await yieldControl();

    // Basic candy trees — yield every ENTITY_BUDGET_MS to avoid blocking the main thread.
    // Tree geometry creation can take 10–30 ms each; without yielding 18 trees back-to-back
    // would stall the browser for up to 540 ms and trigger "Page Unresponsive".
    const treeFactories: Array<() => THREE.Object3D | null> = [
        () => create('bubble_willow'),
        () => create('balloon_bush'),
        () => create('helix_plant'),
        () => create('portamento_pine', { height: 4.5 }),
    ];
    let chunkStart = performance.now();
    for (let i = 0; i < 18; i++) {
        const factory = treeFactories[i % treeFactories.length];
        const pos = getRandomGroundPosition(1.5);
        if (pos) {
            const obj = factory();
            if (!obj) continue;
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
            const obj = create('mushroom', { size: 'regular', scale: 0.8 + Math.random() * 0.5, hasFace: true, isBouncy: true });
            if (!obj) continue;
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
        const cloud = create('cloud', { size: 1.0 + Math.random() * 0.8 });
        if (!cloud) continue;
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
        const factory = Math.random() < 0.5
            ? () => create('flower')
            : () => create('flower', { variant: 'glowing' });
        const pos = getRandomGroundPosition(0.4);
        if (pos) {
            const obj = factory();
            if (!obj) continue;
            obj.position.set(pos.x, pos.y, pos.z);
            obj.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(obj, false, 0.4, weatherSystem);
        }
    }
    await yieldControl();

    // Lake island accents.
    const islandItems: Array<() => THREE.Object3D | null> = [
        () => create('flower', { variant: 'glowing' }),
        () => create('flower'),
    ];
    for (let i = 0; i < 8; i++) {
        const pos = getRandomGroundPosition(0.4);
        if (!pos) continue;
        const factory = islandItems[i % islandItems.length];
        const obj = factory();
        if (!obj) continue;
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
    onProgress?: WorldProgressCallback,
    options?: { fastPopulation?: boolean }
): Promise<WorldMode> {
    worldGenerationToken = Date.now();
    const currentToken = worldGenerationToken;
    console.log(`[World] Starting populateWorld() in ${mode} mode`);

    // Fast Full Mode: apply aggressive population reduction on top of user config
    if (options?.fastPopulation) {
        (window as any).__fastPopulationOverride = true;
        console.log('%c[World] FAST FULL Mode — using heavily reduced object population for quick loads', 'color:#81c784');
    }

    if (mode === 'CORE') {
        console.log('%c[World] CORE Mode active — spawning minimal classic candy set', 'color:#ff9ecd');
        console.log('[World] Core mode skips: map entities, arpeggio grove, procedural extras, WASM physics upload');
        await generateCoreWorld(weatherSystem, onProgress);
        console.log('[World] Core mode ready. Heavy foliage systems skipped.');
        console.log('[World] populateWorld() complete in CORE mode');
        return 'CORE';
    }

    console.log('%c[World] FULL Mode — attempting complete musical ecosystem', 'color:#7dd3fc');
    try {
        const loadedMap = await getLoadedMap();
        console.log(`[World] Full mode: ${loadedMap.entities.length} map entities + ${PROCEDURAL_ENTITY_COUNT} procedural extras to process (population scaled via CONFIG.world.population${options?.fastPopulation ? ' + fast mode multiplier' : ''})`);
        await generateMap(weatherSystem, DEFAULT_MAP_CHUNK_SIZE, onProgress);
        console.log('[World] Full mode population complete.');
        console.log('[World] populateWorld() complete in FULL mode');
    return 'FULL';
    } catch (error) {
        console.error('[World] Full population failed. Falling back from FULL to CORE.', error);
        delete (window as any).__fastPopulationOverride;
        await generateCoreWorld(weatherSystem, onProgress);
        console.log('[World] populateWorld() recovered in CORE mode after FULL failure');
        return 'CORE';
    }
}

export /**
 * Process a single map entity (extracted from forEach loop for chunking)
 */
const MUSICAL_FLORA_TYPES = new Set([
    'arpeggio_fern', 'vibrato_violet', 'tremolo_tulip', 'cymbal_dandelion',
    'snare_trap', 'retrigger_mushroom', 'portamento_pine', 'kick_drum_geyser',
    'panning_pad', 'subwoofer_lotus', 'silence_spirit', 'instrument_shrine',
    'melody_mirror', 'wisteria_cluster', 'accordion_palm', 'fiber_optic_willow',
    'prism_rose_bush', 'starflower',
]);

function processMapEntity(item: MapEntity, weatherSystem: WeatherSystem, options?: ProcessEntityOptions): void {
    const [x, yInput, z] = item.position;
    const entityType = normalizeMapEntityType(item.type);

    // Feature flag gates — skip entire entity without counting as a failure.
    if (!FEATURE_FLAGS.musicalFlora && MUSICAL_FLORA_TYPES.has(entityType)) return;
    if (!FEATURE_FLAGS.luminousPlants && entityType === 'luminous_plant') return;

    const params = item.params ?? {};
    const placement = item.placement ?? (entityType === 'cloud' ? 'absolute' : 'ground');
    // USE UNIFIED HEIGHT for placement
    const groundY = getUnifiedGroundHeight(x, z);
    let y = groundY;
    if (placement === 'absolute' || entityType === 'cloud') y = yInput;
    if (placement === 'offset') y = groundY + yInput;

    const uniformScale = typeof item.scale === 'number' ? item.scale : undefined;
    const vectorScale = Array.isArray(item.scale) ? item.scale : undefined;
    const itemRotation = item.rotation;
    const getParamNumber = (key: string, fallback: number): number => {
        const value = params[key];
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    };
    const getParamBoolean = (key: string, fallback: boolean): boolean => {
        const value = params[key];
        return typeof value === 'boolean' ? value : fallback;
    };
    const annotateMapExport = (obj: THREE.Object3D, resolvedType: string) => {
        const resolvedBiome = item.music?.biomeOverride ?? item.music?.biome ?? item.music?.biomeTag ?? item.biome;
        obj.userData.mapEntityType = resolvedType;
        obj.userData.mapEntityId = item.id;
        obj.userData.biome = resolvedBiome;
        if (typeof item.music?.trackerChannel === 'number') {
            obj.userData.trackerChannel = item.music.trackerChannel;
        }
        if (typeof item.music?.reactivityProfile === 'string') {
            obj.userData.reactivityProfile = item.music.reactivityProfile;
        }
        if (typeof item.music?.intensityScale === 'number') {
            obj.userData.reactivityIntensityScale = item.music.intensityScale;
        }
        obj.userData.mapExport = {
            type: resolvedType,
            sourceId: item.id,
            provenance: 'map',
            variant: item.variant,
            note: item.note,
            noteIndex: item.noteIndex,
            hasFace: item.hasFace,
            category: item.category,
            layer: item.layer,
            biome: resolvedBiome,
            music: item.music,
            placement,
            params
        };
    };

    try {
        let obj: THREE.Object3D | null = null;
        const meta = getTypeMeta(entityType);
        let isObstacle = meta?.defaultIsObstacle ?? false;
        let radius = meta?.defaultRadius ?? 0.5;
        let caveLookAtOrigin = false;
        let caveNeedsWaterfallProxy = false;
        const createParams: Record<string, unknown> = { ...params };
        if (item.variant !== undefined) createParams.variant = item.variant;
        if (item.note !== undefined) createParams.note = item.note;
        if (item.noteIndex !== undefined) createParams.noteIndex = item.noteIndex;
        let cloudTier = 1;

        if (entityType === 'grass') {
            if (FEATURE_FLAGS.grass) addGrassInstance(x, y, z);
            return;
        }
        switch (entityType) {
            case 'mushroom': {
                const isGiant = item.variant === 'giant';
                const hasFace = item.hasFace !== undefined ? item.hasFace : (isGiant || Math.random() < 0.1);
                createParams.size = isGiant ? 'giant' : 'regular';
                createParams.scale = uniformScale ?? 1.0;
                createParams.hasFace = hasFace;
                createParams.isBouncy = isGiant || hasFace;
                if (typeof item.note === 'string') createParams.note = item.note;
                if (Number.isInteger(item.noteIndex)) createParams.noteIndex = item.noteIndex;
                isObstacle = true;
                radius = isGiant ? 2.0 : 0.5;
                break;
            }
            case 'flower':
                createParams.variant = item.variant === 'glowing' ? 'glowing' : 'simple';
                break;
            case 'cloud':
                cloudTier = (item as any).tier || 1;
                createParams.size = typeof item.size === 'number' ? item.size : getParamNumber('size', 1.5);
                break;
            case 'subwoofer_lotus':
            case 'silence_spirit':
            case 'melody_mirror':
                createParams.scale = uniformScale ?? 1.0;
                break;
            case 'floating_orb':
                createParams.size = getParamNumber('size', 0.5);
                y += getParamNumber('hoverOffset', 1.5);
                break;
            case 'swingable_vine': {
                const vineLength = getParamNumber('length', 8);
                createParams.length = vineLength;
                y += vineLength;
                break;
            }
            case 'arpeggio_fern':
                createParams.scale = uniformScale ?? 1.0;
                break;
            case 'portamento_pine':
                createParams.height = getParamNumber('height', 4.0);
                break;
            case 'kick_drum_geyser':
                createParams.maxHeight = getParamNumber('maxHeight', 5.0);
                break;
            case 'cymbal_dandelion':
            case 'snare_trap':
                createParams.scale = uniformScale ?? getParamNumber('scale', 1.0);
                break;
            case 'retrigger_mushroom':
                createParams.scale = uniformScale ?? 1.0;
                createParams.retriggerSpeed = getParamNumber('retriggerSpeed', 4);
                break;
            case 'tremolo_tulip':
                createParams.size = getParamNumber('size', uniformScale ?? 1.0);
                break;
            case 'panning_pad':
                createParams.panBias = x < 0 ? -1 : 1;
                createParams.radius = getParamNumber('radius', uniformScale ?? 1.0);
                if (y < 2) y = 1.0;
                break;
            case 'instrument_shrine': {
                const variantId = parseInt(item.variant || '0', 10);
                createParams.instrumentID = Number.isFinite(variantId) ? variantId : getParamNumber('instrumentID', 0);
                createParams.scale = uniformScale ?? 1.0;
                break;
            }
            case 'wisteria_cluster':
                y += getParamNumber('heightOffset', 4);
                break;
            case 'cave':
                createParams.scale = getParamNumber('scale', uniformScale ?? 2.0);
                isObstacle = getParamBoolean('isObstacle', false);
                radius = getParamNumber('radius', 0);
                caveLookAtOrigin = getParamBoolean('lookAtOrigin', true);
                break;
            default:
                break;
        }

        obj = create(entityType, createParams);
        if (!obj) {
            recordSpawnAttempt(entityType, false, new Error(`Factory returned null for type "${entityType}"`));
            return;
        }

        if (entityType === 'cloud') {
            obj.userData.tier = cloudTier;
            obj.userData.isWalkable = cloudTier === 1;
        } else if (entityType === 'swingable_vine') {
            const vineLength = typeof createParams.length === 'number' ? createParams.length : 8;
            if (vineSwings) vineSwings.push(new VineSwing(obj, vineLength));
        } else if (entityType === 'melody_mirror') {
            if (Number.isInteger(item.noteIndex)) obj.userData.noteIndex = item.noteIndex;
            if (typeof item.note === 'string') obj.userData.note = item.note;
        }
        if (entityType === 'cave') caveNeedsWaterfallProxy = !!obj.userData.gatePosition;

        // --- Spawning ---
        if (obj) {
            annotateMapExport(obj, entityType);
            obj.position.set(x, y, z);
            if (itemRotation && typeof itemRotation === 'object' && !Array.isArray(itemRotation) && 'quat' in itemRotation && Array.isArray(itemRotation.quat)) {
                const [qx, qy, qz, qw] = itemRotation.quat;
                obj.quaternion.set(qx, qy, qz, qw);
            } else if (itemRotation && typeof itemRotation === 'object' && !Array.isArray(itemRotation) && 'euler' in itemRotation && Array.isArray(itemRotation.euler)) {
                const [rx, ry, rz] = itemRotation.euler;
                const order = itemRotation.order;
                const safeOrder = order === 'XYZ' || order === 'YZX' || order === 'ZXY' || order === 'XZY' || order === 'YXZ' || order === 'ZYX'
                    ? order
                    : 'YXZ';
                obj.rotation.set(rx, ry, rz, safeOrder);
            } else if (Array.isArray(itemRotation) && itemRotation.length === 4) {
                const [qx, qy, qz, qw] = itemRotation;
                obj.quaternion.set(qx, qy, qz, qw);
            } else if (Array.isArray(itemRotation) && itemRotation.length === 3) {
                obj.rotation.set(itemRotation[0], itemRotation[1], itemRotation[2], 'YXZ');
            } else if (typeof itemRotation === 'number') {
                obj.rotation.y = itemRotation;
            } else {
                obj.rotation.y = Math.random() * Math.PI * 2;
            }
            if (entityType === 'cave' && caveLookAtOrigin) {
                obj.lookAt(0, y, 0);
            }
            if (vectorScale && entityType !== 'mushroom' && entityType !== 'flower') {
                obj.scale.set(vectorScale[0], vectorScale[1], vectorScale[2]);
            } else if (uniformScale !== undefined && entityType !== 'mushroom' && entityType !== 'flower') {
                obj.scale.setScalar(uniformScale);
            }
            if (options?.streamed && !obj.userData.isBatched) {
                applyDreamyPopIn(obj);
            }
            const placed = safeAddFoliage(obj, isObstacle, radius, weatherSystem);
            if (!placed) {
                recordSpawnAttempt(entityType, false, new Error('CPU animation limit reached; object dropped'));
                return;
            }
            if (entityType === 'cave' && caveNeedsWaterfallProxy && obj.userData.gatePosition) {
                const waterfallProxy = new THREE.Object3D();
                // ⚡ OPTIMIZATION: Bypassed THREE.Object3D proxy by doing pure math composition
                obj.updateMatrix();
                waterfallProxy.position.copy(obj.userData.gatePosition).applyMatrix4(obj.matrix);
                waterfallProxy.userData.type = 'waterfall';
                animatedFoliage.push(waterfallProxy as any);
            }
        }

        recordSpawnAttempt(entityType, true);
    } catch (e) {
        console.warn(`[World] Failed to spawn ${item.type} at ${x},${z}`, e);
        recordSpawnAttempt(item.type || 'unknown', false, e);
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
