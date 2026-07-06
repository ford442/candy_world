import * as THREE from 'three';
import { createIntegratedSpores, createIntegratedGemSparks, registerIntegratedSystem } from '../particles/index.ts';
import { getCIAdjustedCount } from '../core/config.ts';
import { animatedFoliage, cpuAnimatedFoliage } from './state.ts';
import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import { recordSpawnAttempt } from './spawn-tracker.ts';
import { safeAddFoliage } from './generation-entities.ts';
import { worldGenerationToken } from './generation-core.ts';
import {
    PROCEDURAL_ENTITY_COUNT, DEFAULT_PROCEDURAL_CHUNK_SIZE,
    ENTITY_BUDGET_MS, WeatherSystem, FoliageGrowthOptions, yieldControl,
    isPositionValid, normalizeMapEntityType,
    GEM_CANOPY, MYCELIUM_GROVE
} from './generation-utils.ts';
import { create, registerBuiltinWorldObjectTypes } from './foliage-registry.ts';
import { plantOnSurface, sampleGroundY } from './placement-utils.ts';
import { FEATURE_FLAGS } from '../core/config.ts';

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
        const tree = create('gem_canopy_tree', { height: 4.2 + Math.random() * 1.8 });
        if (!tree) continue;
        plantOnSurface(tree, x, z, { groundY: y });
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
            ? create('portamento_pine', { height: 4.0 + Math.random() * 1.5 })
            : create('bubble_willow');
        if (!tree) continue;
        const exportType = usePine ? 'portamento_pine' : 'bubble_willow';
        tree.userData.mapEntityType = exportType;
        tree.userData.mapExport = {
            type: exportType,
            provenance: 'procedural-extra',
            placement: 'ground'
        };
        tree.userData.attachGemFruits = true;
        plantOnSurface(tree, x, z, { groundY: y });
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
        const mushroom = create('glass_mushroom', { scale: 0.8 + Math.random() * 0.9 });
        if (!mushroom) {
            recordSpawnAttempt('glass_mushroom', false, new Error('factory returned null'));
            continue;
        }
        plantOnSurface(mushroom, x, z, { groundY: y });
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
    const extrasCount = PROCEDURAL_ENTITY_COUNT;
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
                     if (obj) obj.position.set(x, currentY, z);
                }
                else if (rand < 0.45) {
                    obj = create('mushroom', {
                         size: 'regular',
                         scale: 0.8 + Math.random() * 0.5,
                         hasFace: true,
                         isBouncy: true
                     });
                     exportType = 'mushroom';
                     exportVariant = 'regular';
                     exportHasFace = true;
                     if (obj) obj.position.set(x, currentY, z);
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

                     if (obj) obj.position.set(x, currentY, z);
                     isObstacle = true;
                     radius = 1.5;
                }
                else if (rand < 0.75) {
                     if (FEATURE_FLAGS.musicalFlora) {
                         const type = Math.random();
                         if (type < 0.15) {
                             obj = create('arpeggio_fern', { scale: 1.0 + Math.random() * 0.5 });
                             exportType = 'arpeggio_fern';
                         } else if (type < 0.28) {
                             obj = create('kick_drum_geyser', { maxHeight: 5.0 + Math.random() * 3.0 });
                             exportType = 'kick_drum_geyser';
                             radius = 1.0;
                         } else if (type < 0.40) {
                             obj = create('snare_trap', { scale: 0.8 + Math.random() * 0.4 });
                             exportType = 'snare_trap';
                             isObstacle = true;
                             radius = 0.8;
                         } else if (type < 0.50) {
                             obj = create('retrigger_mushroom', { scale: 0.8 + Math.random() * 0.4, retriggerSpeed: 2 + Math.floor(Math.random() * 6) });
                             exportType = 'retrigger_mushroom';
                         } else if (type < 0.60) {
                             obj = create('portamento_pine', { height: 4.0 + Math.random() * 2.0 });
                             exportType = 'portamento_pine';
                             isObstacle = true;
                             radius = 0.5;
                         } else if (type < 0.75) {
                             obj = create('tremolo_tulip', { size: 1.0 + Math.random() * 0.5 });
                             exportType = 'tremolo_tulip';
                         } else if (type < 0.85) {
                             obj = create('cymbal_dandelion', { scale: 0.8 + Math.random() * 0.4 });
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
                         if (obj) obj.position.set(x, currentY, z);
                     }
                }
                 else if (rand < 0.90) {
                     // Vertical Ecosystem: Tiered Clouds
                     const tierRoll = Math.random();
                     if (tierRoll < 0.35) {
                         currentY = 35 + Math.random() * 20;
                         const cloudSize = 1.5 + Math.random() * 0.8;
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
                         const cloudSize = 0.8 + Math.random() * 0.6;
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
                     if (obj) obj.position.set(x, currentY, z);
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
                 if (obj) obj.position.set(x, currentY, z);
                 isObstacle = true;
            }

            if (obj) {
                obj.rotation.y = Math.random() * Math.PI * 2;
                const normalizedExportType = normalizeMapEntityType(exportType ?? obj.userData?.type ?? '');
                obj.userData.mapEntityType = normalizedExportType;
                obj.userData.mapExport = {
                    type: normalizedExportType,
                    provenance: 'procedural-extra',
                    variant: exportVariant,
                    hasFace: exportHasFace,
                    placement: normalizedExportType === 'cloud' ? 'absolute' : 'ground',
                    params: Object.keys(exportParams).length > 0 ? exportParams : undefined
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
            if (performance.now() - chunkStart >= ENTITY_BUDGET_MS) {
                await yieldControl();
                chunkStart = performance.now();
            }
            spawnExtra();
            criticalCount++;
            // Also yield immediately AFTER a heavy spawn so the browser can breathe.
            if (performance.now() - chunkStart >= ENTITY_BUDGET_MS) {
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

export function spawnNearbyFoliage(origin: THREE.Vector3, type: string, options: FoliageGrowthOptions, weatherSystem: WeatherSystem | null = null): void {
    if (animatedFoliage.length > 3000) return; // Hard cap

    const maxAttempts = 5;
    for (let i = 0; i < options.maxOffspring; i++) {
        if (Math.random() > options.spawnChanceBase) continue;

        let valid = false;
        let nx = 0, nz = 0;

        for (let a = 0; a < maxAttempts; a++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = (Math.random() * 0.5 + 0.5) * options.spawnRadius;
            nx = origin.x + Math.cos(angle) * dist;
            nz = origin.z + Math.sin(angle) * dist;

            if (isPositionValid(nx, nz, 1.0)) {
                // Check local density
                let localCount = 0;
                // Use a simple distance check against a subset or the WASM grid if available
                for (const plant of cpuAnimatedFoliage) {
                    if (!plant || !plant.position) continue;
                    const dx = plant.position.x - nx;
                    const dz = plant.position.z - nz;
                    if (dx*dx + dz*dz < options.spawnRadius * options.spawnRadius) {
                        localCount++;
                    }
                }

                if (localCount < options.densityLimit) {
                    valid = true;
                    break;
                }
            }
        }

        if (valid) {
            const groundY = sampleGroundY(nx, nz);
            const obj = type === 'mushroom'
                ? create('mushroom', { size: 'regular', scale: 0.8 })
                : create(type);

            if (obj) {
                plantOnSurface(obj, nx, nz, { groundY });
                obj.userData.age = 0;
                obj.userData.lastSpawnTime = Date.now();
                const placed = safeAddFoliage(obj, false, 0.5, weatherSystem);
                if (!placed) {
                    recordSpawnAttempt('procedural_extra', false, new Error('CPU animation limit reached; object dropped'));
                } else {
                    recordSpawnAttempt('procedural_extra', true);
                }

                // If it's a batcher-registered object, it will be added to the batcher.
                // However, safeAddFoliage might push it to arrays that get batched.
                // The weather ecosystem will handle registering mushrooms.
            }
        }
    }
}
