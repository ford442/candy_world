import * as THREE from 'three';
import { CONFIG, FEATURE_FLAGS } from '../core/config.ts';
import { getLoadMemoryTier } from '../core/config.ts';
import {
    createSky,
    createStars,
    createMoon,
    createWaveformWater,
    initFallingBerries,
    initGrassSystem,
    createIsland,
    createTerrainMaterial,
    luminousPlantBatcher,
} from '../foliage/index.ts';
import { validateFoliageMaterials, foliageMaterials } from '../foliage/index.ts';
import { generateCloudLayer } from '../foliage/procedural-sky.ts';
import { treeBatcher } from '../foliage/tree-batcher.ts';
import { createIntegratedFireflies } from '../particles/index.ts';
import { getParticles } from '../particles/lazy.ts';
import { initDiscoveryForFoliage } from '../systems/discovery-optimized.ts';
import { setBiomeRegions } from '../systems/net/biome-at-position.ts';
import { updateProgress } from '../ui/loading-screen.ts';
import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import { endPhase, recordGenerationChunk, startPhase } from '../utils/startup-profiler.ts';
import { initCollisionSystem } from '../utils/wasm-loader.ts';
import { ChunkStreamer, setActiveChunkStreamer } from './chunk-streamer.ts';
import { sampleEntityScale, sampleEntityHeight } from './entity-scale.ts';
import { create, registerBuiltinWorldObjectTypes } from './foliage-registry.ts';
import { safeAddFoliage, processMapEntity } from './generation-entities.ts';
import {
    DEFAULT_MAP_CHUNK_SIZE,
    getEntityBudgetMs,
    getProceduralEntityCount,
    getPopulationScale,
    WeatherSystem,
    WorldObjects,
    WorldMode,
    MapEntity,
    WorldProgressCallback,
    isPositionValid,
    yieldControl,
    SUGAR_CAVES,
    SKY_ISLANDS,
} from './generation-utils.ts';
import { generateGroundHeightmap } from './ground-heightmap.ts';
import type { LoadedCandyMap } from './map-loader.ts';
import {
    clearMapMusicContext,
    deriveMapMusicContext,
    setMapMusicContext,
} from './map-music-context.ts';
import { plantOnSurface, sampleGroundY } from './placement-utils.ts';
import { getReport, reset as resetSpawnTracker } from './spawn-tracker.ts';
import { animatedFoliage, worldGroup } from './state.ts';
import { setMapMetadataSeed } from './world-seed.ts';

let loadedMapPromise: Promise<LoadedCandyMap> | null = null;

// Single source of truth. Used to invalidate stale procedural generation tasks.
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
    'flower',
] as const;

const VISIBLE_BUBBLE_RADIUS = 80;
const VISIBLE_BUBBLE_LIMIT = 300;

/**
 * "play" — chunk-gated boot (#1546/#1548): materialize only the spawn tile
 * synchronously, stream everything else in via ChunkStreamer as the player
 * walks. This is the default so "Enter" stays fast without touching the
 * startup profile / start screen (out of scope for this change — see #1547).
 * "explore" preserves the pre-existing 80m-bubble + horizon-streaming
 * behavior for callers that opt in explicitly.
 */
export type BootPath = 'play' | 'explore';
const DEFAULT_BOOT_PATH: BootPath = 'play';

function buildProceduralBiomeRegions(): import('./map-loader.ts').MapRegion[] {
    const regions: import('./map-loader.ts').MapRegion[] = [];
    if (SKY_ISLANDS.enabled) {
        regions.push({
            id: 'sky_islands',
            name: 'Sky Islands',
            bounds: {
                min: [SKY_ISLANDS.centerX - 40, SKY_ISLANDS.centerZ - 40],
                max: [SKY_ISLANDS.centerX + 40, SKY_ISLANDS.centerZ + 40],
            },
            biome: 'sky_islands',
        });
    }
    if (SUGAR_CAVES.enabled) {
        const minX = Math.min(SUGAR_CAVES.startX, SUGAR_CAVES.endX) - 15;
        const maxX = Math.max(SUGAR_CAVES.startX, SUGAR_CAVES.endX) + 15;
        const minZ = Math.min(SUGAR_CAVES.startZ, SUGAR_CAVES.endZ) - 15;
        const maxZ = Math.max(SUGAR_CAVES.startZ, SUGAR_CAVES.endZ) + 15;
        regions.push({
            id: 'sugar_caves',
            name: 'Sugar Caves',
            bounds: { min: [minX, minZ], max: [maxX, maxZ] },
            biome: 'sugar_caves',
        });
    }
    return regions;
}

function wireBiomeRegions(loadedMap: LoadedCandyMap): void {
    const mapRegions = loadedMap.data.regions ?? [];
    const procedural = buildProceduralBiomeRegions();
    setBiomeRegions([...mapRegions, ...procedural]);
}
const PLAY_SPAWN_RADIUS_CHUNKS = 1;
const PLAY_SPAWN_ENTITY_CAP = 80;

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
        const { getMapSourceFromUrl, loadMap } = await import('./map-loader.ts');
        const defaultSource = new URL('../../assets/map.json', import.meta.url).href;
        const source = getMapSourceFromUrl(defaultSource);
        loadedMapPromise = loadMap(source)
            .catch(async (error) => {
                if (source === defaultSource) throw error;
                console.warn(
                    `[MapLoader] Failed to load "${source}", falling back to default map.`,
                    error
                );
                return loadMap(defaultSource);
            })
            .then((loaded) => {
                setMapMetadataSeed(loaded.data.metadata?.seed);
                setMapMusicContext(deriveMapMusicContext(loaded.data));
                return loaded;
            });
    }
    return loadedMapPromise;
}

if (typeof window !== 'undefined') {
    void import('./map-loader.ts').then(({ getMapSourceFromUrl, setupMapHotReload }) => {
        setupMapHotReload(getMapSourceFromUrl('./assets/map.json'), () => {
            invalidateLoadedMap();
            console.log('[MapLoader] Map asset changed, cache invalidated.');
        });
    });
}

// --- Scene Setup ---
export async function initWorld(
    scene: THREE.Scene,
    weatherSystem: WeatherSystem,
    loadContent: boolean = true
): Promise<WorldObjects> {
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
        console.log('[World] Using GPU Heightmap Displacement');

        const resolution = CONFIG.terrain?.heightmapResolution || 256;
        groundGeo = new THREE.PlaneGeometry(400, 400, resolution, resolution);

        // generateGroundHeightmap is now async and yields internally every 32 rows
        const startParams = performance.now();
        const { heightTexture, normalTexture } = await generateGroundHeightmap(400, resolution);
        console.log(
            `[World] Generated heightmap in ${(performance.now() - startParams).toFixed(2)}ms`
        );

        groundMat = createTerrainMaterial(
            CONFIG.colors.ground,
            {
                roughness: 0.9,
                bumpStrength: 0.15,
                noiseScale: 20.0,
            },
            heightTexture,
            normalTexture
        );
    } else {
        console.log('[World] Using CPU Vertex Displacement');

        groundGeo = new THREE.PlaneGeometry(400, 400, 128, 128);
        const posAttribute = groundGeo.attributes.position;
        const vertexCount = posAttribute.count;
        const cpuYieldEvery = 2000; // yield every ~2k vertices to stay responsive

        for (let i = 0; i < vertexCount; i++) {
            const x = posAttribute.getX(i);
            const y = posAttribute.getY(i); // Plane is on XY
            const zWorld = -y;

            // Use the Unified Height that accounts for the Lake
            const height = sampleGroundY(x, zWorld);
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
            noiseScale: 20.0,
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
    const fogColor = new THREE.Color(CONFIG.colors.fog || 0xffc5d3);
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
            const ly = sampleGroundY(lx, lz);

            if (lx > -10) continue;
            if (ly > 2.0 && ly < 8.0) {
                const plant = create('luminous_plant', {
                    scale: sampleEntityScale('luminous_plant'),
                });
                if (!plant) continue;
                plantOnSurface(plant, lx, lz, { groundY: ly });
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
        generateMap(weatherSystem).catch((err) => {
            console.error('[World] Failed to generate map:', err);
        });
    }

    return { sky, moon, ground };
}

export async function generateMap(
    weatherSystem: WeatherSystem,
    chunkSize: number = DEFAULT_MAP_CHUNK_SIZE,
    onProgress?: WorldProgressCallback,
    bootPath: BootPath = DEFAULT_BOOT_PATH
): Promise<void> {
    worldGenerationToken = Date.now();
    (window as any).__currentWorldGenerationToken = worldGenerationToken;
    const generationToken = worldGenerationToken;
    resetSpawnTracker();
    setActiveChunkStreamer(null);
    performance.mark('candy:map-generation-start');
    console.time('[World] generateMap total');
    // Kick the chunk-index fetch off in parallel with the map fetch (both are
    // simple GETs against static assets) so the play path's critical section
    // only pays for the slower of the two, not both serialized.
    const chunkIndexPromise =
        bootPath === 'play'
            ? import('./map-loader.ts').then((m) => m.loadMapChunkIndex())
            : null;
    const loadedMap = await getLoadedMap();
    wireBiomeRegions(loadedMap);
    applyMapPreallocationHints(loadedMap);
    console.log(
        `[World] Loading map (${loadedMap.source}) with ${loadedMap.entities.length} entities... (bootPath=${bootPath})`
    );

    // Reset WASM Collision System for Generation Phase
    initCollisionSystem();

    if (bootPath === 'play') {
        await generateMapPlayPath(
            loadedMap,
            weatherSystem,
            generationToken,
            chunkSize,
            onProgress,
            chunkIndexPromise!
        );
    } else {
        await generateMapExplorePath(
            loadedMap,
            weatherSystem,
            generationToken,
            chunkSize,
            onProgress
        );
    }

    performance.mark('candy:map-generation-end');
    try {
        performance.measure(
            'candy:Map Generation',
            'candy:map-generation-start',
            'candy:map-generation-end'
        );
    } catch (_e) {
        /* ignore if marks were cleared */
    }

    console.timeEnd('[World] generateMap total');
    console.log('[World] Map streaming bootstrap complete. Horizon tasks queued.');
}

/**
 * Play boot path (#1548): spawn ONLY the player's spawn tile (+1 ring, ≤80
 * entities) synchronously so Enter -> pointer-lock stays fast. Everything
 * else — the rest of the map plus procedural decorators — is handed to
 * ChunkStreamer / the background processor and streams in as the player
 * walks, off the critical path entirely.
 */
async function generateMapPlayPath(
    loadedMap: LoadedCandyMap,
    weatherSystem: WeatherSystem,
    generationToken: number,
    chunkSize: number,
    onProgress: WorldProgressCallback | undefined,
    chunkIndexPromise: Promise<import('./map-loader.ts').MapChunkIndex | null>
): Promise<void> {
    startPhase('Map Streaming Phase 1 (Spawn Chunk)');
    console.time('[World] play-spawn-chunk');
    let chunkIndex = await chunkIndexPromise;
    // A stale index (map.json edited without re-running generate:chunk-index)
    // silently drops entities whose ids no longer resolve — fall back to the
    // bounding-box query path instead of trusting a mismatched index.
    if (chunkIndex && chunkIndex.entityCount !== loadedMap.entities.length) {
        console.warn(
            `[World] Chunk index stale (index has ${chunkIndex.entityCount} entities, ` +
                `loaded map has ${loadedMap.entities.length}) — run "npm run generate:chunk-index". ` +
                'Falling back to bounding-box chunk queries for this session.'
        );
        chunkIndex = null;
    }
    const streamer = new ChunkStreamer(loadedMap, weatherSystem, chunkIndex);
    setActiveChunkStreamer(streamer);
    const spawned = streamer.loadSpawnPlayable(PLAY_SPAWN_RADIUS_CHUNKS, PLAY_SPAWN_ENTITY_CAP);
    console.timeEnd('[World] play-spawn-chunk');
    endPhase('Map Streaming Phase 1 (Spawn Chunk)');
    try {
        (window as any).__playSpawnCount = spawned;
    } catch {
        /* non-browser */
    }
    console.log(
        `[World] Play boot: spawned ${spawned} entities in spawn chunk ` +
            `(${chunkIndex ? `indexed, ${chunkIndex.entityCount} total` : 'bounding-box fallback, no index'}).`
    );

    // NOTE: no initDiscoveryForFoliage() call here — ChunkStreamer registers
    // each spawned object with the discovery grid itself as it loads it
    // (dedup'd by object uuid). Calling initDiscoveryForFoliage(animatedFoliage)
    // here too would double-register the spawn-tile entities.

    if (onProgress) onProgress(spawned, spawned, '[World] Spawn chunk ready');

    queueDecoratorBootstrap(weatherSystem, generationToken, chunkSize);
}

/**
 * Explore boot path: the pre-existing 80m visible-bubble + horizon-streaming
 * behavior, kept for callers that opt in explicitly. Procedural decorators
 * are still deferred to the background processor (not awaited here) so
 * generateMap() resolves — and the world is marked playable — right after
 * phase 1, instead of blocking on the full horizon + decorator population.
 */
async function generateMapExplorePath(
    loadedMap: LoadedCandyMap,
    weatherSystem: WeatherSystem,
    generationToken: number,
    chunkSize: number,
    onProgress?: WorldProgressCallback
): Promise<void> {
    const spawnedEntityIds = new Set<string>();
    const phase1Entities = loadedMap.getNearestEntities({
        origin: [0, 0, 0],
        radius: VISIBLE_BUBBLE_RADIUS,
        limit: VISIBLE_BUBBLE_LIMIT,
        priorityTypes: STREAMING_PRIORITY_TYPES,
    });
    const phase1Total = phase1Entities.length;
    const phase1YieldAt = Math.ceil(phase1Total / 2);
    console.log(
        `[World] Streaming phase 1: spawning ${phase1Total} entities within ${VISIBLE_BUBBLE_RADIUS}m.`
    );

    startPhase('Map Streaming Phase 1 (Visible)');
    console.time('[World] phase1-visible');
    for (let i = 0; i < phase1Total; i++) {
        const entity = phase1Entities[i];
        processMapEntity(entity, weatherSystem);
        spawnedEntityIds.add(entity.id);

        if ((i + 1) % 50 === 0) {
            const percentage = Math.floor(((i + 1) / Math.max(1, phase1Total)) * 100);
            updateProgress(
                'map-generation',
                percentage,
                `Spawning visible bubble: ${i + 1}/${phase1Total}`
            );
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
            console.warn(
                `[World] Phase 1 spawn report: ${r.succeeded} ok, ${r.failed} failed`,
                r.failuresByType
            );
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
                    if (
                        taskToken !== -1 &&
                        taskToken !== currentToken &&
                        !(window as any).__IS_FULL_BOOT_TEST
                    ) {
                        console.warn(
                            `[Generation] Map task obsoleted (token ${taskToken} !== ${currentToken})`
                        );
                        return;
                    }
                    processMapEntity(item as MapEntity, weatherSystem, { streamed: streamFlag });
                },
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

    // 3. Queue Procedural Extras (lazy world-content chunk — #1361).
    // Deferred to the background processor rather than awaited here — this is
    // what previously blocked generateMap() (and therefore "playable") on the
    // full decorator population. See queueDecoratorBootstrap().
    queueDecoratorBootstrap(weatherSystem, generationToken, chunkSize);

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
                if (
                    taskToken !== -1 &&
                    taskToken !== currentToken &&
                    !(window as any).__IS_FULL_BOOT_TEST
                ) {
                    console.warn(
                        `[Generation] Map fallback task obsoleted (token ${taskToken} !== ${currentToken})`
                    );
                    return;
                }
                processMapEntity(item as MapEntity, weatherSystem, { streamed: true });
            },
        });
        fallbackQueued++;
    }
    if (fallbackQueued > 0) {
        console.warn(
            `[World] Fallback queued ${fallbackQueued} entities not covered by streaming rings.`
        );
    }
}

/**
 * Defers the procedural decorator population (extras, gem canopy, mycelium
 * grove, cloud archipelago, sky islands, sugar caves) to the background
 * processor instead of awaiting it inline. This is the piece that previously
 * kept generateMap() — and therefore "playable" — blocked well past phase 1/2
 * on both boot paths.
 */
function queueDecoratorBootstrap(
    weatherSystem: WeatherSystem,
    generationToken: number,
    chunkSize: number
): void {
    globalBackgroundProcessor.enqueue({
        id: 'world_decorators_bootstrap',
        priority: 5,
        execute: async () => {
            const currentToken = (window as any).__currentWorldGenerationToken ?? 0;
            if (
                generationToken !== -1 &&
                generationToken !== currentToken &&
                !(window as any).__IS_FULL_BOOT_TEST
            ) {
                console.warn(
                    `[Generation] Decorator bootstrap obsoleted (token ${generationToken} !== ${currentToken})`
                );
                return;
            }
            console.time('[World] procedural-extras (deferred)');
            try {
                const {
                    populateProceduralExtras,
                    populateGemCanopyCorridor,
                    populateMyceliumGrove,
                    populateCloudArchipelago,
                    populateSkyIslands,
                    populateSugarCaves,
                } = await import('./generation-decorators.ts');
                await populateProceduralExtras(weatherSystem, generationToken, chunkSize);
                await populateGemCanopyCorridor(weatherSystem);
                await populateMyceliumGrove(weatherSystem);
                await populateCloudArchipelago(weatherSystem);
                await populateSkyIslands(weatherSystem);
                await populateSugarCaves(weatherSystem);
                const { installSugarCavesTraversal } = await import('./sugar-caves-traversal.ts');
                installSugarCavesTraversal();
            } finally {
                console.timeEnd('[World] procedural-extras (deferred)');
            }
        },
    });
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
            return { x, z, y: sampleGroundY(x, z) };
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
        () => create('arpeggio_fern', { scale: sampleEntityScale('arpeggio_fern') }),
        () => create('flower'),
        () => create('flower', { variant: 'glowing' }),
        () => create('arpeggio_fern', { scale: sampleEntityScale('arpeggio_fern') }),
    ];
    for (let i = 0; i < SEED_RING_COUNT; i++) {
        const angle = (i / SEED_RING_COUNT) * Math.PI * 2;
        // Even indices → inner ring; odd indices → outer ring for staggered depth.
        const ringRadius = SEED_RING_INNER + (i % 2) * (SEED_RING_OUTER - SEED_RING_INNER);
        const sx = Math.cos(angle) * ringRadius;
        const sz = Math.sin(angle) * ringRadius;
        const sy = sampleGroundY(sx, sz);
        const seedObj = seedFactories[i % seedFactories.length]();
        if (!seedObj) continue;
        plantOnSurface(seedObj, sx, sz, { groundY: sy });
        seedObj.rotation.y = Math.random() * Math.PI * 2;
        safeAddFoliage(seedObj, false, 0.3, weatherSystem);
    }
    await yieldControl();

    // Basic candy trees — yield every getEntityBudgetMs() to avoid blocking the main thread.
    // Tree geometry creation can take 10–30 ms each; without yielding 18 trees back-to-back
    // would stall the browser for up to 540 ms and trigger "Page Unresponsive".
    const treeFactories: Array<() => THREE.Object3D | null> = [
        () => create('bubble_willow'),
        () => create('balloon_bush'),
        () => create('helix_plant'),
        () => create('portamento_pine', { height: sampleEntityHeight('portamento_pine') }),
    ];
    let chunkStart = performance.now();
    for (let i = 0; i < 18; i++) {
        const factory = treeFactories[i % treeFactories.length];
        const pos = getRandomGroundPosition(1.5);
        if (pos) {
            const obj = factory();
            if (!obj) continue;
            plantOnSurface(obj, pos.x, pos.z, { groundY: pos.y });
            obj.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(obj, true, 1.5, weatherSystem);
        }
        if (performance.now() - chunkStart >= getEntityBudgetMs()) {
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
            const obj = create('mushroom', {
                size: 'regular',
                scale: sampleEntityScale('mushroom'),
                hasFace: true,
                isBouncy: true,
            });
            if (!obj) continue;
            plantOnSurface(obj, pos.x, pos.z, { groundY: pos.y });
            obj.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(obj, true, 0.5, weatherSystem);
        }
        if (performance.now() - chunkStart >= getEntityBudgetMs()) {
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
        const cloud = create('cloud', { size: sampleEntityScale('cloud') });
        if (!cloud) continue;
        cloud.position.set(pos.x, height, pos.z);
        cloud.userData.tier = 1;
        cloud.userData.isWalkable = true;
        safeAddFoliage(cloud, false, 0.8, weatherSystem);
        if (performance.now() - chunkStart >= getEntityBudgetMs()) {
            await yieldControl();
            chunkStart = performance.now();
        }
    }
    if (onProgress) onProgress(3, 4, '[World] Core clouds ready', 'cloud');

    // Low flowers and luminous accents (lightweight — single yield at end is sufficient).
    for (let i = 0; i < 16; i++) {
        const factory =
            Math.random() < 0.5
                ? () => create('flower')
                : () => create('flower', { variant: 'glowing' });
        const pos = getRandomGroundPosition(0.4);
        if (pos) {
            const obj = factory();
            if (!obj) continue;
            plantOnSurface(obj, pos.x, pos.z, { groundY: pos.y });
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
        plantOnSurface(obj, pos.x, pos.z, { groundY: pos.y });
        obj.rotation.y = Math.random() * Math.PI * 2;
        safeAddFoliage(obj, false, 0.4, weatherSystem);
    }

    initDiscoveryForFoliage(animatedFoliage);
    if (onProgress) onProgress(4, 4, '[World] Core world population complete', 'flower');
    console.log(
        `[World] Core Only world generation complete. Spawned ${animatedFoliage.length} objects.`
    );
}

export async function populateWorld(
    scene: THREE.Scene,
    weatherSystem: WeatherSystem,
    mode: WorldMode = 'CORE',
    onProgress?: WorldProgressCallback,
    options?: { fastPopulation?: boolean; bootPath?: BootPath }
): Promise<WorldMode> {
    worldGenerationToken = Date.now();
    const currentToken = worldGenerationToken;
    console.log(`[World] Starting populateWorld() in ${mode} mode`);

    // Fast Full Mode: apply aggressive population reduction on top of user config
    if (options?.fastPopulation) {
        (window as any).__fastPopulationOverride = true;
        console.log(
            '%c[World] FAST FULL Mode — using heavily reduced object population for quick loads',
            'color:#81c784'
        );
    }

    if (mode === 'CORE') {
        console.log(
            '%c[World] CORE Mode active — spawning minimal classic candy set',
            'color:#ff9ecd'
        );
        console.log(
            '[World] Core mode skips: map entities, arpeggio grove, procedural extras, WASM physics upload'
        );
        await generateCoreWorld(weatherSystem, onProgress);
        console.log('[World] Core mode ready. Heavy foliage systems skipped.');
        console.log('[World] populateWorld() complete in CORE mode');
        return 'CORE';
    }

    console.log('%c[World] FULL Mode — attempting complete musical ecosystem', 'color:#7dd3fc');
    try {
        const loadedMap = await getLoadedMap();
        console.log(
            `[World] Full mode: ${loadedMap.entities.length} map entities + ${getProceduralEntityCount()} procedural extras to process (population scale=${getPopulationScale().toFixed(2)}, memory tier=${getLoadMemoryTier()}${options?.fastPopulation ? ', fast-full' : ''})`
        );
        await generateMap(
            weatherSystem,
            DEFAULT_MAP_CHUNK_SIZE,
            onProgress,
            options?.bootPath ?? DEFAULT_BOOT_PATH
        );
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

// Compatibility wrappers for refactored startup flow
export async function initCriticalWorld(
    scene: THREE.Scene,
    weatherSystem?: WeatherSystem
): Promise<WorldObjects> {
    if (!weatherSystem) throw new Error('[World] initCriticalWorld: weatherSystem is required');
    return initWorld(scene, weatherSystem, false);
}

export async function initWorldCritical(
    scene: THREE.Scene,
    weatherSystem?: WeatherSystem
): Promise<WorldObjects> {
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
