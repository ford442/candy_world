import * as THREE from 'three';
import { createIntegratedSpores, createIntegratedGemSparks, registerIntegratedSystem } from '../particles/index.ts';
import { getCIAdjustedCount } from '../core/config.ts';
import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import { recordSpawnAttempt } from './spawn-tracker.ts';
import { safeAddFoliage } from './generation-entities.ts';
import { worldGenerationToken } from './generation-core.ts';
import {
    getProceduralEntityCount, DEFAULT_PROCEDURAL_CHUNK_SIZE,
    getEntityBudgetMs, WeatherSystem, FoliageGrowthOptions, yieldControl,
    isPositionValid, normalizeMapEntityType,
    GEM_CANOPY, MYCELIUM_GROVE, CLOUD_ARCHIPELAGO, SKY_ISLANDS
} from './generation-utils.ts';
import { create, registerBuiltinWorldObjectTypes } from './foliage-registry.ts';
import { plantOnSurface, sampleGroundY } from './placement-utils.ts';
import { sampleEntityScale, sampleEntityHeight, biomeNormalizedDistance } from './entity-scale.ts';
import { FEATURE_FLAGS } from '../core/config.ts';
import { createSkyIsland, skyIslandBatcher } from '../foliage/sky-islands.ts';
import {
    registerWalkableIslandPlatform,
    registerWalkableCloudPlatform,
    getGroundHeight,
} from '../systems/ground-system.ts';
import { addCollisionObject } from '../utils/wasm-loader.ts';
import { registerCloudPlatform } from '../debug/ground-debug.ts';
import {
    clearSkyIslandGraph,
    registerSkyIslandNode,
    registerSkyIslandEdge,
    rebuildSkyIslandDebug,
    validateSkyIslandGraph,
    initSkyIslandDebug,
} from './sky-island-graph.ts';
import { CONFIG } from '../core/config.ts';

registerBuiltinWorldObjectTypes();

/** Gem Canopy corridor — tree-lined jewel path receding into foggy distance. */
export async function populateGemCanopyCorridor(weatherSystem: WeatherSystem): Promise<void> {
    if (!GEM_CANOPY.enabled) return;

    console.log('[World] Populating Gem Canopy corridor...');
    const { startX, startZ, endX, endZ, corridorWidth, treeCount } = GEM_CANOPY;
    const dx = endX - startX;
    const dz = endZ - startZ;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const perpX = -dz / len;
    const perpZ = dx / len;

    for (let i = 0; i < treeCount; i++) {
        const t = treeCount > 1 ? i / (treeCount - 1) : 0;
        const side = i % 2 === 0 ? 1 : -1;
        const lateral = (corridorWidth * 0.5 + Math.random() * 2.5) * side;
        const x = startX + dx * t + perpX * lateral + (Math.random() - 0.5) * 2;
        const z = startZ + dz * t + perpZ * lateral + (Math.random() - 0.5) * 2;

        if (!isPositionValid(x, z, 2.0)) continue;
        const y = sampleGroundY(x, z);
        const tree = create('gem_canopy_tree', {
            height: sampleEntityHeight('gem_canopy_tree', { biome: 'gem_canopy', normalizedDistance: t }),
        });
        if (!tree) continue;
        plantOnSurface(tree, x, z, { groundY: y, entityType: 'gem_canopy_tree' });
        tree.rotation.y = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.35;
        tree.userData.biome = 'gem_canopy';
        tree.userData.mapEntityType = 'gem_canopy_tree';
        tree.userData.mapExport = {
            type: 'gem_canopy_tree',
            provenance: 'procedural-extra',
            placement: 'ground'
        };
        const placed = safeAddFoliage(tree, true, 1.5, weatherSystem);
        recordSpawnAttempt('gem_canopy_tree', placed, placed ? undefined : new Error('placement failed'));

        if (i % 4 === 3) await yieldControl();
    }

    // Corridor accent trees: occasional portamento / bubble willow with hanging gems.
    // These reuse GemFruitBatcher.attachToTree so the corridor sparkles even on
    // non-gem-canopy trunks, keeping the jewel motif consistent.
    for (let i = 0; i < 6; i++) {
        const t = (i + 0.5) / 6;
        const x = GEM_CANOPY.startX + (GEM_CANOPY.endX - GEM_CANOPY.startX) * t + (Math.random() - 0.5) * 8;
        const z = GEM_CANOPY.startZ + (GEM_CANOPY.endZ - GEM_CANOPY.startZ) * t + (Math.random() - 0.5) * 8;
        if (!isPositionValid(x, z, 2.0)) continue;
        const y = sampleGroundY(x, z);
        const usePine = i % 2 === 0;
        const tree = usePine
            ? create('portamento_pine', { height: sampleEntityHeight('portamento_pine', { biome: 'gem_canopy', normalizedDistance: t }) })
            : create('bubble_willow', { scale: sampleEntityScale('bubble_willow', { biome: 'gem_canopy', normalizedDistance: t }) });
        if (!tree) continue;
        const exportType = usePine ? 'portamento_pine' : 'bubble_willow';
        tree.userData.mapEntityType = exportType;
        tree.userData.mapExport = {
            type: exportType,
            provenance: 'procedural-extra',
            placement: 'ground'
        };
        tree.userData.attachGemFruits = true;
        plantOnSurface(tree, x, z, { groundY: y, entityType: exportType });
        tree.rotation.y = Math.random() * Math.PI * 2;
        const placed = safeAddFoliage(tree, true, 1.5, weatherSystem);
        recordSpawnAttempt(usePine ? 'portamento_pine' : 'bubble_willow', placed, placed ? undefined : new Error('placement failed'));
    }

    // Global sparkle field — one corridor-wide system (not per-tree).
    const centerX = (GEM_CANOPY.startX + GEM_CANOPY.endX) * 0.5;
    const centerZ = (GEM_CANOPY.startZ + GEM_CANOPY.endZ) * 0.5;
    const centerY = sampleGroundY(centerX, centerZ) + 6;
    const corridorLen = Math.sqrt(dx * dx + dz * dz);
    const sparkBounds = {
        x: corridorLen * 1.15,
        y: 16,
        z: GEM_CANOPY.corridorWidth * 1.8,
    };
    const gemSparks = createIntegratedGemSparks({
        count: getCIAdjustedCount(512, 0.1, 80),
        bounds: sparkBounds,
        center: new THREE.Vector3(centerX, centerY, centerZ),
        useCompute: true,
    });
    safeAddFoliage(gemSparks, false, 0, null);
    if ((gemSparks as any).userData?.computeParticleSystem) {
        registerIntegratedSystem('gem_canopy_sparks', gemSparks, (gemSparks as any).userData.computeParticleSystem);
    }

    console.log(`[World] Gem Canopy corridor populated (${treeCount} trees along path)`);
}

/**
 * Luminous Mycelium Realm — a grove of glass mushrooms wrapped in an ambient,
 * audio-reactive spore field. Companion biome to the Luminous Plants near Melody Lake.
 * Feature-flagged via FEATURE_FLAGS.myceliumRealm for safe boot.
 */
export async function populateMyceliumGrove(weatherSystem: WeatherSystem): Promise<void> {
    if (!FEATURE_FLAGS.myceliumRealm || !MYCELIUM_GROVE.enabled) {
        console.log('[World] Mycelium grove skipped (flag/disabled)');
        return;
    }

    console.log('[World] Populating Luminous Mycelium Realm...');
    const { centerX, centerZ, radius, mushroomCount, sporeCount } = MYCELIUM_GROVE;

    let placed = 0;
    for (let i = 0; i < mushroomCount; i++) {
        // Bias toward the centre (sqrt for area-uniform, squared to cluster inward).
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.pow(Math.random(), 1.6) * radius;
        const x = centerX + Math.cos(angle) * dist;
        const z = centerZ + Math.sin(angle) * dist;

        if (!isPositionValid(x, z, 1.0)) {
            recordSpawnAttempt('glass_mushroom', false, new Error('placement invalid'));
            continue;
        }
        const y = sampleGroundY(x, z);
        const normDist = biomeNormalizedDistance(centerX, centerZ, radius, x, z);
        const mushroom = create('glass_mushroom', {
            scale: sampleEntityScale('glass_mushroom', { biome: 'mycelium_grove', normalizedDistance: normDist }),
        });
        if (!mushroom) {
            recordSpawnAttempt('glass_mushroom', false, new Error('factory returned null'));
            continue;
        }
        plantOnSurface(mushroom, x, z, { groundY: y, entityType: 'glass_mushroom' });
        mushroom.rotation.y = Math.random() * Math.PI * 2;
        const ok = safeAddFoliage(mushroom, true, 0.6, weatherSystem);
        recordSpawnAttempt('glass_mushroom', ok, ok ? undefined : new Error('placement failed'));
        if (ok) placed++;

        if (i % 8 === 7) await yieldControl();
    }

    // Ambient spore field — cyan/purple drift, audio-reactive blink. Registered for
    // per-frame compute updates so bass/melody drive intensity (zero-alloc hot path).
    const groundY = sampleGroundY(centerX, centerZ);
    const spores = createIntegratedSpores({
        count: sporeCount,
        areaSize: radius * 1.4,
        center: new THREE.Vector3(centerX, groundY + 2.5, centerZ),
        useCompute: true,
    });
    safeAddFoliage(spores, false, 0, weatherSystem);
    const sporeSystem = (spores as any).userData?.computeParticleSystem;
    if (sporeSystem) {
        registerIntegratedSystem('mycelium_spores', spores, sporeSystem);
    }

    console.log(`[World] Mycelium Realm populated (${placed}/${mushroomCount} glass mushrooms, ~${sporeCount} spores)`);
}

export async function populateProceduralExtras(
    weatherSystem: WeatherSystem,
    taskToken: number = -1,
    chunkSize: number = DEFAULT_PROCEDURAL_CHUNK_SIZE
): Promise<void> {
    if (!FEATURE_FLAGS.proceduralExtras) {
        console.log('[World] Procedural extras skipped (no_procedural flag)');
        return;
    }
    console.log("[World] Populating procedural extras (Critical + Deferred)...");
    const extrasCount = getProceduralEntityCount();
    const range = 150;

    // We no longer block the main thread for non-critical procedural objects.
    // Instead, we immediately calculate their positions and types.
    // If they are critical, we spawn them now.
    // If deferred, we collect them for near-first sorting before queuing.

    let criticalCount = 0;
    // Track elapsed time so we can yield after each critical spawn that hits the budget.
    let chunkStart = performance.now();

    // Collect deferred items with their squared distance from origin so we can
    // sort them nearest-first before handing them to the background processor.
    const deferredItems: Array<{ distSq: number; id: string; execute: () => void }> = [];

    for (let i = 0; i < extrasCount; i++) {
        let x = 0, z = 0, y = 0;
        let attempts = 0;
        let validPosition = false;

        while (attempts < 10) {
            x = (Math.random() - 0.5) * range;
            z = (Math.random() - 0.5) * range;
            if (isPositionValid(x, z, 1.5)) {
                validPosition = true;
                break;
            }
            attempts++;
        }

        if (!validPosition) continue;
        const groundY = sampleGroundY(x, z);

        // Determine object type and criticality
        const rand = Math.random();

        // Define a closure to spawn this specific extra
        const spawnExtra = () => {
            let obj: THREE.Object3D | null = null;
            let isObstacle = false;
            let radius = 0.5;
            let currentY = groundY;
            let exportType: string | null = null;
            let exportVariant: string | undefined;
            let exportHasFace: boolean | undefined;
            const exportParams: Record<string, unknown> = {};

            try {
                if (rand < 0.3) {
                     if (Math.random() < 0.5) {
                        obj = create('flower');
                         exportType = 'flower';
                         exportVariant = 'simple';
                     } else {
                        obj = create('flower', { variant: 'glowing' });
                         exportType = 'flower';
                         exportVariant = 'glowing';
                     }
                     if (obj) plantOnSurface(obj, x, z, { groundY: currentY, entityType: exportType ?? undefined });
                }
                else if (rand < 0.45) {
                    obj = create('mushroom', {
                         size: 'regular',
                         scale: sampleEntityScale('mushroom'),
                         hasFace: true,
                         isBouncy: true
                     });
                     exportType = 'mushroom';
                     exportVariant = 'regular';
                     exportHasFace = true;
                     if (obj) plantOnSurface(obj, x, z, { groundY: currentY, entityType: exportType ?? undefined });
                     isObstacle = true;
                }
                else if (rand < 0.55) {
                     const treeType = Math.random();
                     if (treeType < 0.33) {
                         obj = create('bubble_willow');
                         exportType = 'bubble_willow';
                     } else if (treeType < 0.66) {
                         obj = create('balloon_bush');
                         exportType = 'balloon_bush';
                     } else {
                         obj = create('helix_plant');
                         exportType = 'helix_plant';
                     }

                     if (obj) plantOnSurface(obj, x, z, { groundY: currentY, entityType: exportType ?? undefined });
                     isObstacle = true;
                     radius = 1.5;
                }
                else if (rand < 0.75) {
                     if (FEATURE_FLAGS.musicalFlora) {
                         const type = Math.random();
                         if (type < 0.15) {
                             obj = create('arpeggio_fern', { scale: sampleEntityScale('arpeggio_fern') });
                             exportType = 'arpeggio_fern';
                         } else if (type < 0.28) {
                             obj = create('kick_drum_geyser', { maxHeight: sampleEntityHeight('kick_drum_geyser') });
                             exportType = 'kick_drum_geyser';
                             radius = 1.0;
                         } else if (type < 0.40) {
                             obj = create('snare_trap', { scale: sampleEntityScale('snare_trap') });
                             exportType = 'snare_trap';
                             isObstacle = true;
                             radius = 0.8;
                         } else if (type < 0.50) {
                             obj = create('retrigger_mushroom', { scale: sampleEntityScale('retrigger_mushroom'), retriggerSpeed: 2 + Math.floor(Math.random() * 6) });
                             exportType = 'retrigger_mushroom';
                         } else if (type < 0.60) {
                             obj = create('portamento_pine', { height: sampleEntityHeight('portamento_pine') });
                             exportType = 'portamento_pine';
                             isObstacle = true;
                             radius = 0.5;
                         } else if (type < 0.75) {
                             obj = create('tremolo_tulip', { size: sampleEntityScale('tremolo_tulip') });
                             exportType = 'tremolo_tulip';
                         } else if (type < 0.85) {
                             obj = create('cymbal_dandelion', { scale: sampleEntityScale('cymbal_dandelion') });
                             exportType = 'cymbal_dandelion';
                         } else {
                             const panBias = x < 0 ? -1 : 1;
                             const padRadius = 1.2 + Math.random();
                             obj = create('panning_pad', { radius: padRadius, panBias });
                             exportType = 'panning_pad';
                             exportParams.radius = padRadius;
                             currentY = groundY + 0.5;
                             if (obj) obj.position.y = currentY;
                         }
                         if (obj) {
                             if (exportType === 'panning_pad') {
                                 obj.position.set(x, currentY, z);
                             } else {
                                 plantOnSurface(obj, x, z, { groundY: currentY, entityType: exportType ?? undefined });
                             }
                         }
                     }
                }
                 else if (rand < 0.90) {
                     // Vertical Ecosystem: Tiered Clouds
                     const tierRoll = Math.random();
                     if (tierRoll < 0.35) {
                         currentY = 35 + Math.random() * 20;
                         const cloudSize = sampleEntityScale('cloud_tier1');
                         obj = create('cloud', { size: cloudSize });
                         exportType = 'cloud';
                         exportParams.size = cloudSize;
                         exportParams.tier = 1;
                         if (obj) {
                             obj.userData.tier = 1;
                             obj.userData.isWalkable = true;
                         }
                         if (Math.random() < 0.3) {
                             const ladderLength = currentY - groundY;
                             if (ladderLength > 5) {
                                 const ladder = create('vine_ladder', { length: ladderLength });
                                 if (ladder) {
                                     ladder.userData.mapEntityType = 'vine_ladder';
                                     ladder.userData.mapExport = {
                                         type: 'vine_ladder',
                                         provenance: 'procedural-extra',
                                         placement: 'absolute',
                                         params: { length: ladderLength }
                                     };
                                     ladder.position.set(x, currentY, z);
                                     const placed = safeAddFoliage(ladder, false, 0, weatherSystem);
                                     if (!placed) {
                                         recordSpawnAttempt('procedural_extra', false, new Error('CPU animation limit reached; object dropped'));
                                     } else {
                                         recordSpawnAttempt('procedural_extra', true);
                                     }
                                 }
                             }
                         }
                     } else {
                         currentY = 12 + Math.random() * 16;
                         const cloudSize = sampleEntityScale('cloud_tier2');
                         obj = create('cloud', { size: cloudSize });
                         exportType = 'cloud';
                         exportParams.size = cloudSize;
                         exportParams.tier = 2;
                         if (obj) {
                             obj.userData.tier = 2;
                             obj.userData.isWalkable = false;
                         }
                     }
                     if (obj) obj.position.set(x, currentY, z);
                 }
                 else if (rand < 0.95) {
                    obj = create('silence_spirit');
                     exportType = 'silence_spirit';
                     if (obj) plantOnSurface(obj, x, z, { groundY: currentY, entityType: exportType ?? undefined });
                 }
                 else if (rand < 0.97) {
                    obj = create('melody_mirror', { scale: 2.0 });
                     exportType = 'melody_mirror';
                     if (obj) obj.position.set(x, groundY + 15 + Math.random() * 10, z);
                 }
             else {
                 const id = Math.floor(Math.random() * 16);
                 obj = create('instrument_shrine', { instrumentID: id });
                 exportType = 'instrument_shrine';
                 exportVariant = String(id);
                 exportParams.instrumentID = id;
                 if (obj) plantOnSurface(obj, x, z, { groundY: currentY, entityType: exportType });
                 isObstacle = true;
            }

            if (obj) {
                obj.rotation.y = Math.random() * Math.PI * 2;
                const normalizedExportType = normalizeMapEntityType(exportType ?? obj.userData?.type ?? '');
                obj.userData.mapEntityType = normalizedExportType;
                let hasParams = false;
                for (const _ in exportParams) {
                    hasParams = true;
                    break;
                }

                obj.userData.mapExport = {
                    type: normalizedExportType,
                    provenance: 'procedural-extra',
                    variant: exportVariant,
                    hasFace: exportHasFace,
                    placement: normalizedExportType === 'cloud' ? 'absolute' : 'ground',
                    params: hasParams ? exportParams : undefined
                };
                const placed = safeAddFoliage(obj, isObstacle, radius, weatherSystem);
                 if (!placed) {
                     recordSpawnAttempt('procedural_extra', false, new Error('CPU animation limit reached; object dropped'));
                 } else {
                     recordSpawnAttempt('procedural_extra', true);
                 }
            }
            } catch (e) {
                console.warn(`[World] Failed to spawn procedural extra at ${x},${z}`, e);
                recordSpawnAttempt('procedural_extra', false, e);
            }
        };

        // Narrowed criticality: only physics-relevant objects need to block the loading phase.
        // 0.00 - 0.30: Flowers               → Deferred (no collision)
        // 0.30 - 0.45: Mushrooms              → Critical (bouncy, obstacle)
        // 0.45 - 0.55: Trees                  → Critical (obstacle)
        // 0.55 - 0.75: Musical interactables  → Deferred (no physics impact on player movement)
        // 0.75 - 0.90: Clouds                 → Deferred (walkable tier-1 clouds are uncommon;
        //                                         accepting them being added a frame late is fine)
        // > 0.90: Spirits, Mirrors, Shrines   → Deferred (purely decorative / audio-reactive)
        //
        // Result: only ~25 % of procedural extras are critical (down from 70 %),
        // cutting synchronous spawn time by ~65 %.
        const isCritical = rand >= 0.30 && rand < 0.55;

        if (isCritical) {
            // Yield BEFORE a potentially heavy spawn if we have already burned the budget
            // in a previous spawn.  This prevents a single heavy tree (10–30 ms) from
            // stacking on top of an already-overrun chunk and compounding the stall.
            if (performance.now() - chunkStart >= getEntityBudgetMs()) {
                await yieldControl();
                chunkStart = performance.now();
            }
            spawnExtra();
            criticalCount++;
            // Also yield immediately AFTER a heavy spawn so the browser can breathe.
            if (performance.now() - chunkStart >= getEntityBudgetMs()) {
                await yieldControl();
                chunkStart = performance.now();
            }
        } else {
            deferredItems.push({ distSq: x * x + z * z, id: `procedural_deferred_${i}`, execute: spawnExtra });
        }
    }

    // Sort deferred extras nearest-first so the background processor populates the
    // area around the player before filling in the far horizon.
    deferredItems.sort((a, b) => a.distSq - b.distSq);
    const proceduralTaskToken = worldGenerationToken;
    for (const item of deferredItems) {
        // ⚡ OPTIMIZATION: Bypassed Math.sqrt() in hot procedural sorting loop using distance decay estimation
        const priority = Math.max(1, 60 - Math.floor(item.distSq / 16));
        globalBackgroundProcessor.enqueue({ id: item.id, execute: () => {
             const currentToken = (window as any).__currentWorldGenerationToken ?? worldGenerationToken;
             if (taskToken !== -1 && taskToken !== currentToken && !(window as any).__IS_FULL_BOOT_TEST) {
                 console.warn(`[Generation] Procedural task obsoleted (token ${taskToken} !== ${currentToken})`);
                 return;
             }
             item.execute();
         }, priority });
    }

    console.log(`[World] Procedural Extras: ${criticalCount} critical spawned, ${deferredItems.length} deferred (sorted near-first).`);
}

/**
 * Ascending walkable cloud staircase into the sky-islands biome (#1266 / #1363).
 * Uses CLOUD_ARCHIPELAGO constants; ends near the low_mist island deck.
 */
export async function populateCloudArchipelago(weatherSystem: WeatherSystem): Promise<void> {
    if (!CLOUD_ARCHIPELAGO.enabled) return;

    console.log('[World] Populating cloud archipelago approach stairs...');
    clearSkyIslandGraph();
    const { startX, startZ, platforms, stepY, heightOffset } = CLOUD_ARCHIPELAGO;
    const groundY = sampleGroundY(startX, startZ);

    registerSkyIslandNode({
        id: 'approach:ground',
        layerId: 'ground',
        x: startX,
        y: groundY,
        z: startZ,
        kind: 'ground',
    });

    let prevCloudId: string | null = 'approach:ground';
    for (let i = 0; i < platforms; i++) {
        const t = platforms > 1 ? i / (platforms - 1) : 0;
        const x = startX + t * 8 + Math.sin(i * 1.7) * 2.5;
        const z = startZ + t * 12 + Math.cos(i * 1.3) * 2.5;
        const y = heightOffset + i * stepY;
        const size = 1.6 + (i % 3) * 0.25;

        const cloud = create('cloud', {
            size,
            scale: size,
            tier: CONFIG.cloud.walkableTier ?? 1,
        });
        if (!cloud) {
            recordSpawnAttempt('cloud', false, new Error('factory returned null'));
            continue;
        }

        cloud.position.set(x, y, z);
        cloud.userData.tier = 1;
        cloud.userData.isWalkable = true;
        cloud.userData.cloudScale = size;
        cloud.userData.biome = 'sky_islands';
        cloud.userData.mapEntityType = 'cloud';
        cloud.userData.mapExport = {
            type: 'cloud',
            provenance: 'cloud-archipelago',
            placement: 'absolute',
            tier: 1,
            params: { size, tier: 1 },
        };

        const placed = safeAddFoliage(cloud, false, 0, weatherSystem);
        recordSpawnAttempt('cloud', placed, placed ? undefined : new Error('placement failed'));
        if (!placed) continue;

        // Ensure walkable registration even if createCloud onPlacement already ran
        registerWalkableCloudPlatform(cloud);
        registerCloudPlatform(cloud);

        const nodeId = `approach:cloud:${i}`;
        registerSkyIslandNode({
            id: nodeId,
            layerId: 'approach',
            x, y, z,
            kind: 'cloud',
        });
        if (prevCloudId) {
            registerSkyIslandEdge({
                id: `edge:${prevCloudId}->${nodeId}`,
                from: prevCloudId,
                to: nodeId,
                kind: i === 0 ? 'approach' : 'cloud_hop',
            });
        }
        prevCloudId = nodeId;

        if (i % 3 === 2) await yieldControl();
    }

    console.log(`[World] Cloud archipelago: ${platforms} walkable stairs from Y≈${heightOffset}`);
}

/**
 * Stacked sky islands — low mist / mid canopy / high nebula (#1363).
 * Absolute Y tiers + vine ladders + cloud ring + panning lift pads.
 */
export async function populateSkyIslands(weatherSystem: WeatherSystem): Promise<void> {
    if (!SKY_ISLANDS.enabled) return;

    console.log('[World] Populating Sky Islands biome...');
    skyIslandBatcher.clear();

    // Keep approach nodes from populateCloudArchipelago; only seed ground if missing
    const approachX = CLOUD_ARCHIPELAGO.startX;
    const approachZ = CLOUD_ARCHIPELAGO.startZ;
    registerSkyIslandNode({
        id: 'approach:ground',
        layerId: 'ground',
        x: approachX,
        y: sampleGroundY(approachX, approachZ),
        z: approachZ,
        kind: 'ground',
    });

    for (let li = 0; li < SKY_ISLANDS.layers.length; li++) {
        const layer = SKY_ISLANDS.layers[li];
        const x = SKY_ISLANDS.centerX + layer.offsetX;
        const z = SKY_ISLANDS.centerZ + layer.offsetZ;
        const y = layer.y;

        // Validate absolute Y is well above terrain (unified ground query)
        const terrainY = getGroundHeight(x, z);
        if (y <= terrainY + 4) {
            console.warn(`[SkyIslands] layer ${layer.id} Y=${y} too close to terrain ${terrainY.toFixed(2)}; skipping`);
            recordSpawnAttempt('sky_island', false, new Error('Y overlap with terrain'));
            continue;
        }

        const island = createSkyIsland({
            radius: layer.radius,
            height: layer.height,
            kind: layer.kind,
            layerId: layer.id,
        });
        island.position.set(x, y, z);
        island.userData.persistentId = `sky_island:${layer.id}`;
        island.userData.mapEntityType = 'sky_island';
        island.userData.mapExport = {
            type: 'sky_island',
            provenance: 'sky-islands',
            placement: 'absolute',
            biome: 'sky_islands',
            params: { layer: layer.id, kind: layer.kind, radius: layer.radius },
        };

        const placed = safeAddFoliage(island, false, 0, weatherSystem);
        recordSpawnAttempt('sky_island', placed, placed ? undefined : new Error('placement failed'));
        if (!placed) continue;

        registerWalkableIslandPlatform(island);
        skyIslandBatcher.register(island);

        // Collision AABB matching platform bounds (type, x, y, z, halfX, halfY, halfZ, p2)
        addCollisionObject(2, x, y - layer.height * 0.2, z, layer.radius * 0.9, layer.height * 0.4, layer.radius * 0.9, 0);

        const nodeId = `island:${layer.id}`;
        registerSkyIslandNode({
            id: nodeId,
            layerId: layer.id,
            x, y, z,
            kind: 'island',
        });

        // --- Layer-specific dressing ---
        if (layer.kind === 'mist') {
            // Walkable cloud ring + panning lift pads
            for (let c = 0; c < SKY_ISLANDS.cloudRingCount; c++) {
                const a = (c / SKY_ISLANDS.cloudRingCount) * Math.PI * 2;
                const cx = x + Math.cos(a) * (layer.radius + 4);
                const cz = z + Math.sin(a) * (layer.radius + 4);
                const cy = y - 1.5 + (c % 2) * 1.2;
                const cloud = create('cloud', { size: 1.4, tier: 1 });
                if (!cloud) continue;
                cloud.position.set(cx, cy, cz);
                cloud.userData.tier = 1;
                cloud.userData.isWalkable = true;
                cloud.userData.cloudScale = 1.4;
                cloud.userData.biome = 'sky_islands';
                cloud.userData.mapEntityType = 'cloud';
                if (safeAddFoliage(cloud, false, 0, weatherSystem)) {
                    registerWalkableCloudPlatform(cloud);
                    registerCloudPlatform(cloud);
                    const cid = `mist:cloud:${c}`;
                    registerSkyIslandNode({ id: cid, layerId: layer.id, x: cx, y: cy, z: cz, kind: 'cloud' });
                    registerSkyIslandEdge({
                        id: `edge:${cid}->${nodeId}`,
                        from: cid,
                        to: nodeId,
                        kind: 'cloud_hop',
                    });
                }
            }
            for (let p = 0; p < SKY_ISLANDS.panningPadCount; p++) {
                const a = (p / SKY_ISLANDS.panningPadCount) * Math.PI * 2 + 0.5;
                const px = x + Math.cos(a) * (layer.radius * 0.55);
                const pz = z + Math.sin(a) * (layer.radius * 0.55);
                const pad = create('panning_pad', { radius: 1.4, panBias: p % 2 === 0 ? -1 : 1 });
                if (!pad) continue;
                pad.position.set(px, y + 0.4, pz);
                pad.userData.biome = 'sky_islands';
                pad.userData.mapEntityType = 'panning_pad';
                if (safeAddFoliage(pad, false, 0, weatherSystem)) {
                    const pid = `mist:pad:${p}`;
                    registerSkyIslandNode({ id: pid, layerId: layer.id, x: px, y: y + 0.4, z: pz, kind: 'pad' });
                    registerSkyIslandEdge({
                        id: `edge:${nodeId}->${pid}`,
                        from: nodeId,
                        to: pid,
                        kind: 'lift_pad',
                    });
                }
            }
        } else if (layer.kind === 'canopy') {
            // Wisteria bridge accents + gem canopy sapling
            for (let w = 0; w < 3; w++) {
                const a = (w / 3) * Math.PI * 2;
                const wx = x + Math.cos(a) * (layer.radius * 0.6);
                const wz = z + Math.sin(a) * (layer.radius * 0.6);
                const wisteria = create('wisteria_cluster', { scale: 0.85 });
                if (!wisteria) continue;
                wisteria.position.set(wx, y, wz);
                wisteria.userData.biome = 'sky_islands';
                safeAddFoliage(wisteria, false, 0, weatherSystem);
            }
            const gem = create('gem_canopy_tree', { height: 4.2 });
            if (gem) {
                gem.position.set(x + 1.5, y, z - 1.2);
                gem.userData.biome = 'gem_canopy';
                safeAddFoliage(gem, true, 1.2, weatherSystem);
            }
        } else if (layer.kind === 'nebula') {
            // Glass mushrooms + silence spirits
            for (let m = 0; m < 5; m++) {
                const a = (m / 5) * Math.PI * 2;
                const mx = x + Math.cos(a) * (layer.radius * 0.45);
                const mz = z + Math.sin(a) * (layer.radius * 0.45);
                const mush = create('glass_mushroom', { scale: 0.7 + Math.random() * 0.4 });
                if (!mush) continue;
                mush.position.set(mx, y, mz);
                mush.userData.biome = 'sky_islands';
                safeAddFoliage(mush, false, 0, weatherSystem);
            }
            for (let s = 0; s < 2; s++) {
                const spirit = create('silence_spirit', { scale: 1.0 });
                if (!spirit) continue;
                spirit.position.set(x + (s === 0 ? -2 : 2), y + 1.2, z);
                spirit.userData.biome = 'sky_islands';
                safeAddFoliage(spirit, false, 0, weatherSystem);
            }
        }

        // Vine ladder from previous tier (or approach cloud apex)
        if (SKY_ISLANDS.vineLadders && li > 0) {
            const prev = SKY_ISLANDS.layers[li - 1];
            const prevX = SKY_ISLANDS.centerX + prev.offsetX;
            const prevZ = SKY_ISLANDS.centerZ + prev.offsetZ;
            const prevY = prev.y;
            const ladderLength = y - prevY;
            const midX = (x + prevX) * 0.5;
            const midZ = (z + prevZ) * 0.5;
            const ladder = create('vine_ladder', { length: ladderLength });
            if (ladder) {
                // Ladder hangs from upper island toward lower (pivot at top)
                ladder.position.set(midX, y, midZ);
                ladder.userData.mapEntityType = 'vine_ladder';
                ladder.userData.biome = 'sky_islands';
                ladder.userData.mapExport = {
                    type: 'vine_ladder',
                    provenance: 'sky-islands',
                    placement: 'absolute',
                    params: { length: ladderLength },
                };
                if (safeAddFoliage(ladder, false, 0, weatherSystem)) {
                    const prevId = `island:${prev.id}`;
                    registerSkyIslandEdge({
                        id: `edge:${prevId}->${nodeId}`,
                        from: prevId,
                        to: nodeId,
                        kind: 'vine_ladder',
                    });
                }
            }
        } else if (SKY_ISLANDS.vineLadders && li === 0) {
            // Ladder from last cloud stair height into low mist
            const approachTopY = CLOUD_ARCHIPELAGO.heightOffset + (CLOUD_ARCHIPELAGO.platforms - 1) * CLOUD_ARCHIPELAGO.stepY;
            const ladderLength = Math.max(5, y - approachTopY);
            const lx = (x + approachX + 8) * 0.5;
            const lz = (z + approachZ + 12) * 0.5;
            const ladder = create('vine_ladder', { length: ladderLength });
            if (ladder) {
                ladder.position.set(lx, y, lz);
                ladder.userData.mapEntityType = 'vine_ladder';
                ladder.userData.biome = 'sky_islands';
                if (safeAddFoliage(ladder, false, 0, weatherSystem)) {
                    registerSkyIslandEdge({
                        id: `edge:approach->${nodeId}`,
                        from: 'approach:ground',
                        to: nodeId,
                        kind: 'vine_ladder',
                    });
                }
            }
        }

        await yieldControl();
    }

    const validation = validateSkyIslandGraph();
    if (!validation.ok) {
        console.warn('[SkyIslands] connectivity graph warnings:', validation.errors);
    }

    // Expose graph for debug / tests; scene attach happens via initSkyIslandDebug when flag set
    try {
        const scene = (window as any).__scene as THREE.Scene | undefined;
        if (scene) {
            initSkyIslandDebug(scene);
            rebuildSkyIslandDebug();
        } else {
            (window as any).__initSkyIslandDebugWhenReady = true;
        }
    } catch { /* ignore */ }

    (window as any).__skyIslandsReady = {
        layers: SKY_ISLANDS.layers.map(l => ({ id: l.id, y: l.y })),
        islandCount: skyIslandBatcher.count,
        graphOk: validation.ok,
    };

    console.log(`[World] Sky Islands populated (${skyIslandBatcher.count} landmasses, graph ${validation.ok ? 'ok' : 'warn'})`);
}

