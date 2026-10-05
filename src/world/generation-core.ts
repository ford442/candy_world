import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { float, color as tslColor } from 'three/tsl';
import { CONFIG, FEATURE_FLAGS, getLoadMemoryTier } from '../core/config.ts';
import { getStartupCapabilities } from '../core/startup/capabilities.ts';
import {
    createSky,
    createStars,
    createMoon,
    createWaveformWater,
    initFallingBerries,
    initGrassSystem,
    createIsland,
    luminousPlantBatcher,
    createJuicyRimLight,
} from '../foliage/index.ts';
import { validateFoliageMaterials, foliageMaterials } from '../foliage/index.ts';
import { generateCloudLayer } from '../foliage/procedural-sky.ts';
import { treeBatcher } from '../foliage/tree-batcher.ts';
import { createIntegratedFireflies } from '../particles/index.ts';
import { initDiscoveryForFoliage } from '../systems/discovery-optimized.ts';
import { DEBUG_CONFIG } from '../debug/stages.ts';
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
    obstaclesData,
} from './generation-utils.ts';
import type { LoadedCandyMap } from './map-loader.ts';
import {
    clearMapMusicContext,
    deriveMapMusicContext,
    setMapMusicContext,
} from './map-music-context.ts';
import { plantOnSurface, sampleGroundY } from './placement-utils.ts';
import { getReport, reset as resetSpawnTracker } from './spawn-tracker.ts';
import {
    animatedFoliage,
    computeFoliageObjects,
    cpuAnimatedFoliage,
    foliageGroup,
    worldGroup,
} from './state.ts';
import { createPathTerrain, rebuildTerrainForPath } from './terrain-mesh.ts';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import { LOBBY_FLOOR_TOP_Y, LOBBY_SPAWN_X, LOBBY_SPAWN_Z, PLAY_SPAWN_RADIUS_CHUNKS, PLAY_WORLD_SIZE } from './world-extent.ts';
import { setMapMetadataSeed } from './world-seed.ts';

let loadedMapPromise: Promise<LoadedCandyMap> | null = null;
/** What initWorld built, so a start-screen path change can add or drop pieces. */
let builtOutdoorSetpieces = false;
let builtSkyClouds = false;
let builtFireflyCount = 0;
let builtGrassCapacity = 0;
let builtGrassMeshes: THREE.Object3D[] = [];

type DecoratorStreamerMod = typeof import('./decorator-streamer.ts');
let decoratorStreamerMod: DecoratorStreamerMod | null = null;

async function decoratorStreamer(): Promise<DecoratorStreamerMod> {
    if (!decoratorStreamerMod) {
        decoratorStreamerMod = await import('./decorator-streamer.ts');
    }
    return decoratorStreamerMod;
}

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
const PLAY_SPAWN_ENTITY_CAP = 96;

function applyMapPreallocationHints(loadedMap: LoadedCandyMap, bootPath: BootPath): void {
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
    let treeHint = Math.max(explicitTreeHint ?? 0, derivedTreeHint);
    // Play only materializes the spawn ring up front — don't GPU-alloc the full map.
    if (bootPath === 'play') {
        treeHint = Math.min(treeHint, 96);
    }
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

    const world = getStartupCapabilities().world;
    builtOutdoorSetpieces = world.outdoorSetpieces;

    // Sky, stars, moon (fast — no yield needed)
    const sky = createSky();
    scene.add(sky);

    const stars = createStars();
    scene.add(stars);

    const moon = createMoon();
    moon.position.set(-50, 60, -30); // High up
    scene.add(moon);

    // Visual terrain sized to the boot path (Play ~180, Explore ~400, CORE ~120).
    await yieldControl();
    const ground = await createPathTerrain();
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
        builtGrassMeshes = initGrassSystem(scene, world.grassCapacity);
        builtGrassCapacity = world.grassCapacity;
    }

    // Use CPU fallback for fireflies during startup. GPU compute init is async but can hang
    // on systems with partial WebGPU support; the CPU path is safe and fast enough for 150 particles.
    if (FEATURE_FLAGS.fireflies && world.fireflyCount > 0) {
        scene.add(
            createIntegratedFireflies({
                count: world.fireflyCount,
                areaSize: Math.min(100, world.size),
                useCompute: false,
            })
        );
        builtFireflyCount = world.fireflyCount;
    }

    // Procedural Cloud Layer (Background)
    if (world.skyCloudCount > 0) {
        await yieldControl();
        generateCloudLayer(scene, world.skyCloudCount);
        builtSkyClouds = true;
    }

    // Lobby boots skip the outdoor set (lake, island, luminous ring, berries) entirely.
    if (world.outdoorSetpieces) {
        await buildOutdoorSetpieces(scene, weatherSystem, world.luminousPlantCount);
    }

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

async function buildOutdoorSetpieces(
    scene: THREE.Scene,
    weatherSystem: WeatherSystem,
    luminousCount: number
): Promise<void> {
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
    const { resetDecoratorStreamer } = await decoratorStreamer();
    resetDecoratorStreamer();
    performance.mark('candy:map-generation-start');
    console.time('[World] generateMap total');
    // Kick the chunk-index fetch off in parallel with the map fetch (both are
    // simple GETs against static assets) so the play path's critical section
    // only pays for the slower of the two, not both serialized.
    const chunkIndexPromise =
        bootPath === 'play' ? import('./map-loader.ts').then((m) => m.loadMapChunkIndex()) : null;
    const loadedMap = await getLoadedMap();
    wireBiomeRegions(loadedMap);
    applyMapPreallocationHints(loadedMap, bootPath);
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
    const spawned = await streamer.loadSpawnPlayable(
        PLAY_SPAWN_RADIUS_CHUNKS,
        PLAY_SPAWN_ENTITY_CAP
    );
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

    const { initDecoratorStreamer } = await decoratorStreamer();
    initDecoratorStreamer(weatherSystem, generationToken, chunkSize, {
        extrasRange: PLAY_WORLD_SIZE,
        eagerAll: false,
    });
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

    // 3. Stream procedural setpieces (lazy world-content — #1361).
    // Deferred so generateMap() resolves after phase 1.
    const { initDecoratorStreamer } = await decoratorStreamer();
    initDecoratorStreamer(weatherSystem, generationToken, chunkSize, {
        extrasRange: 300,
        eagerAll: true,
    });

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
    // player spawn so the world feels immediately populated right after the
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
        const sx = CONFIG.player.spawnX + Math.cos(angle) * ringRadius;
        const sz = CONFIG.player.spawnZ + Math.sin(angle) * ringRadius;
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
    if (DEBUG_CONFIG.enabled) assertCoreWorldPlayable(weatherSystem);
}

/** Debug-only check that CORE mode produced the minimum playable scene. */
function assertCoreWorldPlayable(weatherSystem: WeatherSystem | undefined): void {
    const missing: string[] = [];
    if (!Number.isFinite(sampleGroundY(CONFIG.player.spawnX, CONFIG.player.spawnZ))) {
        missing.push('ground at spawn');
    }
    if (obstaclesData.length === 0) missing.push('physics obstacle');
    if (!weatherSystem) missing.push('weatherSystem');
    if (missing.length > 0) {
        console.warn(`[World] Core world incomplete — missing: ${missing.join(', ')}`);
    }
}


/** Half-width of the playable lobby floor (metres). Walls sit just outside. */
const LOBBY_ROOM_HALF = 10;
const LOBBY_WALL_HEIGHT = 6.5;
const LOBBY_WALL_THICKNESS = 0.7;

function removeFromArray<T>(arr: T[], item: T): void {
    const idx = arr.indexOf(item);
    if (idx !== -1) arr.splice(idx, 1);
}

/**
 * `?boot=lobby` never builds the outdoor set. When Lobby was picked on the
 * start screen instead, the Play-sized terrain and lake set already exist:
 * dispose them (not just hide) and shrink the terrain to the lobby footprint
 * so the edge clamp keeps the player near the room.
 */
async function prepareSceneForLobby(scene: THREE.Scene): Promise<void> {
    if (builtOutdoorSetpieces) {
        const doomed: THREE.Object3D[] = [];
        scene.traverse((obj) => {
            const t = obj.userData?.type;
            if (t === 'water' || t === 'lake_island') doomed.push(obj);
        });
        for (const obj of doomed) {
            removeFromArray(animatedFoliage, obj as any);
            removeFromArray(cpuAnimatedFoliage, obj as any);
            removeFromArray(computeFoliageObjects, obj as any);
            if (obj.userData.type === 'lake_island') {
                const i = obstaclesData.findIndex(
                    (o) => o.x === obj.position.x && o.z === obj.position.z
                );
                if (i !== -1) obstaclesData.splice(i, 1);
            }
            safeRemoveAndDispose(obj.parent ?? foliageGroup, obj);
        }
        builtOutdoorSetpieces = false;
    }
    await rebuildTerrainForPath(scene);
}

function buildLobbyWalls(scene: THREE.Scene): void {
    const floor = new THREE.Mesh(
        new THREE.BoxGeometry(LOBBY_ROOM_HALF * 2 + 1.2, 0.45, LOBBY_ROOM_HALF * 2 + 1.2),
        new THREE.MeshPhysicalMaterial({
            color: 0xf8bbd0,
            roughness: 0.28,
            metalness: 0,
            clearcoat: 0.85,
            clearcoatRoughness: 0.2,
        })
    );
    floor.position.set(0, LOBBY_FLOOR_TOP_Y - 0.22, 0);
    floor.userData.type = 'lobby_floor';
    floor.userData.isWalkable = true;
    floor.receiveShadow = true;
    scene.add(floor);

    const wallMat = new MeshPhysicalNodeMaterial({
        color: 0xffb6c8,
        roughness: 0.22,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.18,
    });
    wallMat.emissiveNode = createJuicyRimLight(tslColor(0xffb6c8), float(1.0), float(3.0), null);
    const half = LOBBY_ROOM_HALF;
    const h = LOBBY_WALL_HEIGHT;
    const thick = LOBBY_WALL_THICKNESS;
    const doorWidth = 3.2;
    const specs: Array<{ w: number; d: number; x: number; z: number }> = [
        { w: half * 2 + thick, d: thick, x: 0, z: -half },
        { w: (half * 2 - doorWidth) / 2, d: thick, x: -(half + doorWidth / 2) / 2, z: half },
        { w: (half * 2 - doorWidth) / 2, d: thick, x: (half + doorWidth / 2) / 2, z: half },
        { w: thick, d: half * 2 + thick, x: -half, z: 0 },
        { w: thick, d: half * 2 + thick, x: half, z: 0 },
    ];
    // One shared unit box, scaled per wall.
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    for (const spec of specs) {
        const mesh = new THREE.Mesh(wallGeo, wallMat);
        mesh.scale.set(spec.w, h, spec.d);
        mesh.position.set(spec.x, h * 0.5, spec.z);
        mesh.userData.type = 'lobby_wall';
        mesh.userData.isObstacle = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
    }

    const ceiling = new THREE.Mesh(
        new THREE.BoxGeometry(half * 2 + thick, 0.35, half * 2 + thick),
        new THREE.MeshStandardMaterial({
            color: 0xffe4f0,
            roughness: 0.35,
            metalness: 0,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
        })
    );
    ceiling.position.set(0, h + 0.1, 0);
    ceiling.userData.type = 'lobby_ceiling';
    scene.add(ceiling);
}

/**
 * Inverse of {@link prepareSceneForLobby}: the page booted as Lobby (URL or
 * remembered path) but the player switched back to Play / Explore / Core on
 * the start screen. Build the outdoor pieces initWorld skipped.
 */
async function restoreOutdoorSetForPath(
    scene: THREE.Scene,
    weatherSystem: WeatherSystem
): Promise<void> {
    const world = getStartupCapabilities().world;
    if (!world.outdoorSetpieces || builtOutdoorSetpieces) return;
    console.log('[World] Path changed from Lobby — building the outdoor set');

    await rebuildTerrainForPath(scene);

    if (FEATURE_FLAGS.grass && builtGrassCapacity < world.grassCapacity) {
        for (const mesh of builtGrassMeshes) safeRemoveAndDispose(scene, mesh);
        builtGrassMeshes = initGrassSystem(scene, world.grassCapacity);
        builtGrassCapacity = world.grassCapacity;
    }

    const extraFireflies = world.fireflyCount - builtFireflyCount;
    if (FEATURE_FLAGS.fireflies && extraFireflies > 0) {
        scene.add(
            createIntegratedFireflies({
                count: extraFireflies,
                areaSize: Math.min(100, world.size),
                useCompute: false,
            })
        );
        builtFireflyCount = world.fireflyCount;
    }

    if (!builtSkyClouds && world.skyCloudCount > 0) {
        await yieldControl();
        generateCloudLayer(scene, world.skyCloudCount);
        builtSkyClouds = true;
    }

    await buildOutdoorSetpieces(scene, weatherSystem, world.luminousPlantCount);
    builtOutdoorSetpieces = true;
}

export async function generateLobbyWorld(
    scene: THREE.Scene,
    weatherSystem: WeatherSystem,
    onProgress?: WorldProgressCallback
): Promise<void> {
    console.log('[World] Lobby mode: building one-room candy lobby');
    initCollisionSystem();
    await prepareSceneForLobby(scene);
    buildLobbyWalls(scene);

    const spawnX = LOBBY_SPAWN_X;
    const spawnZ = LOBBY_SPAWN_Z;

    if (onProgress) onProgress(0, 3, '[World] Framing lobby room');

    const placements: Array<{
        type: string;
        x: number;
        z: number;
        params?: Record<string, unknown>;
    }> = [
        { type: 'mushroom', x: spawnX + 3.2, z: spawnZ - 2.4 },
        { type: 'mushroom', x: spawnX - 3.6, z: spawnZ + 1.8 },
        { type: 'instrument_shrine', x: spawnX, z: spawnZ - 5.5, params: { scale: 1.1 } },
        { type: 'retrigger_mushroom', x: spawnX + 5.2, z: spawnZ + 3.4 },
        { type: 'flower', x: spawnX - 2.2, z: spawnZ + 4.6, params: { variant: 'glowing' } },
        { type: 'flower', x: spawnX + 2.4, z: spawnZ + 5.0 },
        { type: 'flower', x: spawnX - 5.4, z: spawnZ - 3.2, params: { variant: 'glowing' } },
        { type: 'arpeggio_fern', x: spawnX + 4.8, z: spawnZ - 4.4 },
        { type: 'luminous_plant', x: spawnX - 4.6, z: spawnZ - 5.0 },
        { type: 'luminous_plant', x: spawnX + 1.6, z: spawnZ + 6.2 },
    ];

    let placed = 0;
    for (const item of placements) {
        const obj = create(item.type, item.params);
        if (!obj) continue;
        plantOnSurface(obj, item.x, item.z, { groundY: LOBBY_FLOOR_TOP_Y });
        obj.rotation.y = Math.random() * Math.PI * 2;
        safeAddFoliage(obj, item.type === 'mushroom' || item.type === 'instrument_shrine', 0.6, weatherSystem);
        placed += 1;
    }
    // The outdoor set normally parents this batcher; Lobby boots skip that set.
    if (FEATURE_FLAGS.luminousPlants && !luminousPlantBatcher.mesh.parent) {
        scene.add(luminousPlantBatcher.mesh);
    }
    if (onProgress) onProgress(1, 3, `[World] Lobby props (${placed})`, 'lobby');

    for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + 0.4;
        const cloud = create('cloud', { size: sampleEntityScale('cloud') });
        if (!cloud) continue;
        cloud.position.set(Math.cos(angle) * 6, 8.5 + (i % 2) * 0.8, Math.sin(angle) * 6);
        cloud.userData.tier = 1;
        safeAddFoliage(cloud, false, 0.8, weatherSystem);
    }
    if (onProgress) onProgress(2, 3, '[World] Lobby lantern-clouds', 'cloud');

    await yieldControl();
    if (onProgress) onProgress(3, 3, '[World] Lobby room ready');
    console.log(`[World] Lobby ready (${placed} props + walls).`);
}

export async function populateWorld(
    scene: THREE.Scene,
    weatherSystem: WeatherSystem,
    mode: WorldMode = 'CORE',
    onProgress?: WorldProgressCallback,
    options?: { fastPopulation?: boolean; bootPath?: BootPath; lobby?: boolean }
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

    if (mode === 'LOBBY' || options?.lobby) {
        console.log('%c[World] LOBBY Mode — one-room candy lobby', 'color:#ffd54f');
        await generateLobbyWorld(scene, weatherSystem, onProgress);
        console.log('[World] populateWorld() complete in LOBBY mode');
        return 'LOBBY';
    }

    await restoreOutdoorSetForPath(scene, weatherSystem);

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
