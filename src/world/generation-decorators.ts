import * as THREE from 'three';
import { createIntegratedPollen, createIntegratedSparks, registerIntegratedSystem } from '../particles/index.ts';
import { animatedFoliage, cpuAnimatedFoliage } from './state.ts';
import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import { recordSpawnAttempt } from './spawn-tracker.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { spawnImpact } from '../foliage/impacts.ts';
import { makeInteractive } from '../utils/interaction-utils.ts';
import { safeAddFoliage, worldGenerationToken } from './generation-core.ts';
import {
    ARPEGGIO_GROVE, LAKE_ISLAND, PROCEDURAL_ENTITY_COUNT, DEFAULT_PROCEDURAL_CHUNK_SIZE,
    ENTITY_BUDGET_MS, WeatherSystem, FoliageGrowthOptions, yieldControl,
    getUnifiedGroundHeight, isPositionValid, normalizeMapEntityType,
    ARPEGGIO_GROVE_FERN_COUNT, ARPEGGIO_GROVE_OUTER_COUNT,
    LAKE_ARPEGGIO_FERN_COUNT, LAKE_DANDELION_COUNT
} from './generation-utils.ts';
import { create, registerBuiltinWorldObjectTypes } from './foliage-registry.ts';
import { FEATURE_FLAGS } from '../core/config.ts';

registerBuiltinWorldObjectTypes();

export /**
 * Populates the Arpeggio Grove set piece.
 * Fern and outer counts are now configurable via CONFIG.world.population
 * to allow faster Full mode loading.
 * Yields control to the browser between batches.
 */
async function populateArpeggioGrove(weatherSystem: WeatherSystem): Promise<void> {
    if (!ARPEGGIO_GROVE.enabled) return;

    console.log("[World] Populating Arpeggio Grove...");

    const { centerX, centerZ, radius } = ARPEGGIO_GROVE;

    // Central feature: Subwoofer Lotus
    const centralLotus = create('subwoofer_lotus', { scale: 1.5 });
    if (!centralLotus) return;
    const centralY = getUnifiedGroundHeight(centerX, centerZ);
    centralLotus.position.set(centerX, centralY, centerZ);
    safeAddFoliage(centralLotus, false, 0, weatherSystem);
    await yieldControl();

    // Arpeggio Ferns ring (count controlled via CONFIG.world.population for faster Full mode loads)
    const fernCount = ARPEGGIO_GROVE_FERN_COUNT;
    const fernRadius = radius * 0.4;
    for (let i = 0; i < fernCount; i++) {
        const angle = (i / fernCount) * Math.PI * 2;
        const fx = centerX + Math.cos(angle) * fernRadius;
        const fz = centerZ + Math.sin(angle) * fernRadius;
        const fy = getUnifiedGroundHeight(fx, fz);

        const fern = create('arpeggio_fern', { scale: 1.2 + Math.random() * 0.3 });
        if (!fern) continue;
        fern.position.set(fx, fy, fz);
        fern.rotation.y = angle + Math.PI; // Face outward or inward? Let's say outward
        safeAddFoliage(fern, false, 0, weatherSystem);
        if (i % 4 === 3) await yieldControl();
    }

    // Outer ring: Kick Drum Geysers and Vibrato Violets
    const outerCount = ARPEGGIO_GROVE_OUTER_COUNT;
    const outerRadius = radius * 0.8;
    for (let i = 0; i < outerCount; i++) {
        const angle = (i / outerCount) * Math.PI * 2 + 0.2;
        const ox = centerX + Math.cos(angle) * outerRadius;
        const oz = centerZ + Math.sin(angle) * outerRadius;
        const oy = getUnifiedGroundHeight(ox, oz);

        if (i % 2 === 0) {
            const geyser = create('kick_drum_geyser', { maxHeight: 5.0 + Math.random() * 2.0 });
            if (!geyser) continue;
            geyser.position.set(ox, oy, oz);
            geyser.rotation.y = angle;
            safeAddFoliage(geyser, false, 1.0, weatherSystem);
        } else {
            const violet = create('vibrato_violet', { intensity: 1.5 });
            if (!violet) continue;
            violet.position.set(ox, oy, oz);
            violet.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(violet, false, 0, weatherSystem);
        }
        if (i % 4 === 3) await yieldControl();
    }

    // Glowing flower accents (yield every 5 flowers)
    const flowerCount = 15;
    for (let i = 0; i < flowerCount; i++) {
        const randAngle = Math.random() * Math.PI * 2;
        const randRadius = Math.random() * radius;
        const fx = centerX + Math.cos(randAngle) * randRadius;
        const fz = centerZ + Math.sin(randAngle) * randRadius;
        const fy = getUnifiedGroundHeight(fx, fz);

        const flower = create('flower', { variant: 'glowing' });
        if (!flower) continue;
        flower.position.set(fx, fy, fz);
        flower.rotation.y = Math.random() * Math.PI * 2;
        safeAddFoliage(flower, false, 0, weatherSystem);
        if (i % 5 === 4) await yieldControl();
    }

    console.log(`[World] Arpeggio Grove populated at (${centerX}, ${centerZ})`);
}

export /**
 * Populates the Lake Island with a curated selection of musical flora.
 * The island serves as a focal point for audio-reactive elements.
 */
function populateLakeIsland(weatherSystem: WeatherSystem): void {
    if (!LAKE_ISLAND.enabled) return;

    console.log("[World] Populating Lake Island with musical flora...");

    const { centerX, centerZ, radius, peakHeight } = LAKE_ISLAND;

    // Central feature: Large Retrigger Mushroom
    const centralMushroom = create('retrigger_mushroom', {
        scale: 1.5,
        retriggerSpeed: 4,
        color: 0x00FFFF
    });
    if (!centralMushroom) return;
    const centralY = getUnifiedGroundHeight(centerX, centerZ);
    centralMushroom.position.set(centerX, centralY, centerZ);
    makeInteractive(centralMushroom);
    centralMushroom.userData.interactionText = "Harvest Lake Core";
    centralMushroom.userData.onInteract = () => {
        unlockSystem.harvest('lake_core', 1, 'Lake Core');
        spawnImpact(centralMushroom.position, 'spore', 0x00FFFF);
        centralMushroom.userData.interactionText = "Harvested";
        centralMushroom.userData.onInteract = undefined;
    };
    safeAddFoliage(centralMushroom, false, 0, weatherSystem);

    // Ring of Kick Drum Geysers around the perimeter
    const geyserCount = 6;
    const geyserRadius = radius * 0.7;
    for (let i = 0; i < geyserCount; i++) {
        const angle = (i / geyserCount) * Math.PI * 2;
        const gx = centerX + Math.cos(angle) * geyserRadius;
        const gz = centerZ + Math.sin(angle) * geyserRadius;
        const gy = getUnifiedGroundHeight(gx, gz);

        const geyser = create('kick_drum_geyser', { maxHeight: 4.0 + Math.random() * 2.0 });
        if (!geyser) continue;
        geyser.position.set(gx, gy, gz);
        geyser.rotation.y = angle + Math.PI; // Face outward
        safeAddFoliage(geyser, false, 1.0, weatherSystem);
    }

    // Inner ring: Alternating Vibrato Violets and Tremolo Tulips
    const flowerCount = 8;
    const flowerRadius = radius * 0.45;
    for (let i = 0; i < flowerCount; i++) {
        const angle = (i / flowerCount) * Math.PI * 2 + 0.3; // Offset from geysers
        const fx = centerX + Math.cos(angle) * flowerRadius;
        const fz = centerZ + Math.sin(angle) * flowerRadius;
        const fy = getUnifiedGroundHeight(fx, fz);

        const flower = i % 2 === 0
            ? create('vibrato_violet', { intensity: 1.2 })
            : create('tremolo_tulip', { size: 1.2 });
        if (!flower) continue;
        flower.position.set(fx, fy, fz);
        flower.rotation.y = Math.random() * Math.PI * 2;
        safeAddFoliage(flower, false, 0, weatherSystem);
    }

    // Scattered Arpeggio Ferns (lake island)
    const fernCount = LAKE_ARPEGGIO_FERN_COUNT;
    for (let i = 0; i < fernCount; i++) {
        // Random position within island
        const randAngle = Math.random() * Math.PI * 2;
        const randRadius = Math.random() * (radius * 0.6);
        const fx = centerX + Math.cos(randAngle) * randRadius;
        const fz = centerZ + Math.sin(randAngle) * randRadius;
        const fy = getUnifiedGroundHeight(fx, fz);

        const fern = create('arpeggio_fern', { scale: 0.8 + Math.random() * 0.4 });
        if (!fern) continue;
        fern.position.set(fx, fy, fz);
        fern.rotation.y = Math.random() * Math.PI * 2;
        safeAddFoliage(fern, false, 0, weatherSystem);
    }

    // Edge decorations: Cymbal Dandelions
    const dandelionCount = LAKE_DANDELION_COUNT;
    for (let i = 0; i < dandelionCount; i++) {
        const angle = (i / dandelionCount) * Math.PI * 2 + Math.random() * 0.2;
        const edgeOffset = radius * 0.85 + Math.random() * (radius * 0.1);
        const dx = centerX + Math.cos(angle) * edgeOffset;
        const dz = centerZ + Math.sin(angle) * edgeOffset;
        const dy = getUnifiedGroundHeight(dx, dz);

        // Only place if we're still above water
        if (dy > 1.6) {
            const dandelion = create('cymbal_dandelion', { scale: 0.7 + Math.random() * 0.3 });
            if (!dandelion) continue;
            dandelion.position.set(dx, dy, dz);
            dandelion.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(dandelion, false, 0, weatherSystem);
        }
    }

    // Corner accent: Snare Traps near the edges
    const trapCount = 3;
    for (let i = 0; i < trapCount; i++) {
        const angle = (i / trapCount) * Math.PI * 2 + Math.PI / 6;
        const tx = centerX + Math.cos(angle) * (radius * 0.55);
        const tz = centerZ + Math.sin(angle) * (radius * 0.55);
        const ty = getUnifiedGroundHeight(tx, tz);

        const trap = create('snare_trap', { scale: 0.9 });
        if (!trap) continue;
        trap.position.set(tx, ty, tz);
        trap.rotation.y = angle;
        safeAddFoliage(trap, true, 0.8, weatherSystem);
    }

    // ⚡ JUICE: Neon Pollen Cloud
    // Audio-reactive magic dust covering the island
    const pollen = createIntegratedPollen({ count: 100, areaSize: 25, center: new THREE.Vector3(centerX, 5, centerZ), useCompute: true });
    safeAddFoliage(pollen, false, 0, null);
    if ((pollen as any).userData?.computeParticleSystem) {
        registerIntegratedSystem('pollen_island', pollen, (pollen as any).userData.computeParticleSystem);
    }

    // ⚡ JUICE: Environmental Sparks around the Core
    const ambientSparks = createIntegratedSparks({ count: 100, areaSize: 15, center: new THREE.Vector3(centerX, 2, centerZ), useCompute: true });
    safeAddFoliage(ambientSparks, false, 0, null);
    if ((ambientSparks as any).userData?.computeParticleSystem) {
        registerIntegratedSystem('sparks_island', ambientSparks, (ambientSparks as any).userData.computeParticleSystem);
    }

    const ambientIslandSparks = createIntegratedSparks({ count: 100, areaSize: 15, center: new THREE.Vector3(centerX, 2, centerZ), useCompute: true });
    safeAddFoliage(ambientIslandSparks, false, 0, null);
    if ((ambientIslandSparks as any).userData?.computeParticleSystem) {
        registerIntegratedSystem('sparks_island', ambientIslandSparks, (ambientIslandSparks as any).userData.computeParticleSystem);
    }

    // ⚡ JUICE: Environmental Sparks
    // Add ambient sparks to the world
    const sparksAmbient = createIntegratedSparks({ count: 100, areaSize: 50, center: new THREE.Vector3(centerX, 10, centerZ), useCompute: true });
    safeAddFoliage(sparksAmbient, false, 0, null);
    const globalSparks = createIntegratedSparks({ count: 100, areaSize: 50, center: new THREE.Vector3(centerX, 10, centerZ), useCompute: true });
    safeAddFoliage(globalSparks, false, 0, null);

    console.log(`[World] Lake Island populated with musical flora at (${centerX}, ${centerZ})`);
}

export async function populateProceduralExtras(
    weatherSystem: WeatherSystem,
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
        const groundY = getUnifiedGroundHeight(x, z);

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
                                     safeAddFoliage(ladder, false, 0, weatherSystem);
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
                safeAddFoliage(obj, isObstacle, radius, weatherSystem);
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
    for (const item of deferredItems) {
        const priority = Math.max(1, 60 - Math.floor(Math.sqrt(item.distSq) / 4));
        const taskToken = (window as any).__currentWorldGenerationToken ?? worldGenerationToken;
        globalBackgroundProcessor.enqueue({
            id: item.id,
            execute: () => {
                const currentToken = (window as any).__currentWorldGenerationToken ?? 0;
                if (taskToken !== currentToken) { return; }
                item.execute();
            },
            priority
        });
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
            const groundY = getUnifiedGroundHeight(nx, nz);
            const obj = type === 'mushroom'
                ? create('mushroom', { size: 'regular', scale: 0.8 })
                : create(type);

            if (obj) {
                obj.position.set(nx, groundY, nz);
                obj.userData.age = 0;
                obj.userData.lastSpawnTime = Date.now();
                safeAddFoliage(obj, false, 0.5, weatherSystem);

                // If it's a batcher-registered object, it will be added to the batcher.
                // However, safeAddFoliage might push it to arrays that get batched.
                // The weather ecosystem will handle registering mushrooms.
            }
        }
    }
}
