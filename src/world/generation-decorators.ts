import * as THREE from 'three';
import {
    createMushroom, createGlowingFlower, createFlower, createSubwooferLotus,
    createVineLadder, createVibratoViolet, createTremoloTulip, createKickDrumGeyser,
    createRainingCloud, createArpeggioFern, createPortamentoPine, createCymbalDandelion,
    createSnareTrap, createBubbleWillow, createHelixPlant, createBalloonBush,
    createPanningPad, createSilenceSpirit, createInstrumentShrine, createMelodyMirror,
    createRetriggerMushroom
} from '../foliage/index.ts';
import { createIntegratedPollen, createIntegratedSparks, registerIntegratedSystem } from '../particles/index.ts';
import { animatedFoliage, cpuAnimatedFoliage } from './state.ts';
import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { spawnImpact } from '../foliage/impacts.ts';
import { makeInteractive } from '../utils/interaction-utils.ts';
import { safeAddFoliage } from './generation-core.ts';
import {
    ARPEGGIO_GROVE, LAKE_ISLAND, PROCEDURAL_ENTITY_COUNT, DEFAULT_PROCEDURAL_CHUNK_SIZE,
    ENTITY_BUDGET_MS, WeatherSystem, FoliageGrowthOptions, yieldControl,
    getUnifiedGroundHeight, isPositionValid,
    ARPEGGIO_GROVE_FERN_COUNT, ARPEGGIO_GROVE_OUTER_COUNT,
    LAKE_ARPEGGIO_FERN_COUNT, LAKE_DANDELION_COUNT
} from './generation-utils.ts';

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
    const centralLotus = createSubwooferLotus({ scale: 1.5 });
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

        const fern = createArpeggioFern({ scale: 1.2 + Math.random() * 0.3 });
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
            const geyser = createKickDrumGeyser({ maxHeight: 5.0 + Math.random() * 2.0 });
            geyser.position.set(ox, oy, oz);
            geyser.rotation.y = angle;
            safeAddFoliage(geyser, false, 1.0, weatherSystem);
        } else {
            const violet = createVibratoViolet({ intensity: 1.5 });
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

        const flower = createGlowingFlower();
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
    const centralMushroom = createRetriggerMushroom({
        scale: 1.5,
        retriggerSpeed: 4,
        color: 0x00FFFF
    });
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

        const geyser = createKickDrumGeyser({ maxHeight: 4.0 + Math.random() * 2.0 });
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
            ? createVibratoViolet({ intensity: 1.2 })
            : createTremoloTulip({ size: 1.2 });
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

        const fern = createArpeggioFern({ scale: 0.8 + Math.random() * 0.4 });
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
            const dandelion = createCymbalDandelion({ scale: 0.7 + Math.random() * 0.3 });
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

        const trap = createSnareTrap({ scale: 0.9 });
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
    console.log("[World] Populating procedural extras (Critical + Deferred)...");
    const extrasCount = PROCEDURAL_ENTITY_COUNT;
    const range = 150;

    // We no longer block the main thread for non-critical procedural objects.
    // Instead, we immediately calculate their positions and types.
    // If they are critical, we spawn them now.
    // If deferred, we queue them in the BackgroundProcessor.

    let criticalCount = 0;
    let deferredCount = 0;
    // Track elapsed time so we can yield after each critical spawn that hits the budget.
    let chunkStart = performance.now();

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

            try {
                if (rand < 0.3) {
                     obj = Math.random() < 0.5 ? createFlower() : createGlowingFlower();
                     obj.position.set(x, currentY, z);
                }
                else if (rand < 0.45) {
                     obj = createMushroom({
                         size: 'regular',
                         scale: 0.8 + Math.random() * 0.5,
                         hasFace: true,
                         isBouncy: true
                     });
                     obj.position.set(x, currentY, z);
                     isObstacle = true;
                }
                else if (rand < 0.55) {
                     const treeType = Math.random();
                     if (treeType < 0.33) obj = createBubbleWillow();
                     else if (treeType < 0.66) obj = createBalloonBush();
                     else obj = createHelixPlant();

                     obj.position.set(x, currentY, z);
                     isObstacle = true;
                     radius = 1.5;
                }
                else if (rand < 0.75) {
                     const type = Math.random();
                     if (type < 0.15) {
                         obj = createArpeggioFern({ scale: 1.0 + Math.random() * 0.5 });
                     } else if (type < 0.28) {
                         obj = createKickDrumGeyser({ maxHeight: 5.0 + Math.random() * 3.0 });
                         radius = 1.0;
                     } else if (type < 0.40) {
                         obj = createSnareTrap({ scale: 0.8 + Math.random() * 0.4 });
                         isObstacle = true;
                         radius = 0.8;
                     } else if (type < 0.50) {
                         obj = createRetriggerMushroom({ scale: 0.8 + Math.random() * 0.4, retriggerSpeed: 2 + Math.floor(Math.random() * 6) });
                     } else if (type < 0.60) {
                         obj = createPortamentoPine({ height: 4.0 + Math.random() * 2.0 });
                         isObstacle = true;
                         radius = 0.5;
                     } else if (type < 0.75) {
                         obj = createTremoloTulip({ size: 1.0 + Math.random() * 0.5 });
                     } else if (type < 0.85) {
                         obj = createCymbalDandelion({ scale: 0.8 + Math.random() * 0.4 });
                     } else {
                         const panBias = x < 0 ? -1 : 1;
                         obj = createPanningPad({ radius: 1.2 + Math.random(), panBias });
                         currentY = groundY + 0.5;
                         obj.position.y = currentY;
                     }
                     if (obj) obj.position.set(x, currentY, z);
                }
                 else if (rand < 0.90) {
                     // Vertical Ecosystem: Tiered Clouds
                     const tierRoll = Math.random();
                     if (tierRoll < 0.35) {
                         currentY = 35 + Math.random() * 20;
                         obj = createRainingCloud({ size: 1.5 + Math.random() * 0.8 });
                         obj.userData.tier = 1;
                         obj.userData.isWalkable = true;
                         if (Math.random() < 0.3) {
                             const ladderLength = currentY - groundY;
                             if (ladderLength > 5) {
                                 const ladder = createVineLadder({ length: ladderLength });
                                 ladder.position.set(x, currentY, z);
                                 safeAddFoliage(ladder, false, 0, weatherSystem);
                             }
                         }
                     } else {
                         currentY = 12 + Math.random() * 16;
                         obj = createRainingCloud({ size: 0.8 + Math.random() * 0.6 });
                         obj.userData.tier = 2;
                         obj.userData.isWalkable = false;
                     }
                     obj.position.set(x, currentY, z);
                 }
                 else if (rand < 0.95) {
                     obj = createSilenceSpirit();
                     obj.position.set(x, currentY, z);
                 }
                 else if (rand < 0.97) {
                     obj = createMelodyMirror({ scale: 2.0 });
                     obj.position.set(x, groundY + 15 + Math.random() * 10, z);
                 }
             else {
                 const id = Math.floor(Math.random() * 16);
                 obj = createInstrumentShrine({ instrumentID: id });
                 obj.position.set(x, currentY, z);
                 isObstacle = true;
            }

            if (obj) {
                obj.rotation.y = Math.random() * Math.PI * 2;
                safeAddFoliage(obj, isObstacle, radius, weatherSystem);
            }
            } catch (e) {
                console.warn(`[World] Failed to spawn procedural extra at ${x},${z}`, e);
            }
        };

        // Heuristic to decide if critical based on the random roll
        // 0.00 - 0.30: Flowers (Deferred)
        // 0.30 - 0.45: Mushroom (Critical - bouncy)
        // 0.45 - 0.55: Trees (Critical - obstacle)
        // 0.55 - 0.75: Musical interactables (Critical)
        // 0.75 - 0.90: Clouds (Critical if walkable, let's treat all clouds as critical for simplicity)
        // > 0.90: Spirits, Mirrors, Shrines (Critical)

        const isCritical = rand >= 0.30; // Flowers are < 0.30

        if (isCritical) {
            spawnExtra();
            criticalCount++;
            // Time-based yield after each critical spawn.
            // Count-based yielding (e.g. every 25 iterations) is unreliable when entity
            // creation takes 10–30 ms each: 25 × 30 ms = 750 ms worst case per chunk.
            // Instead we yield as soon as the ENTITY_BUDGET_MS wall-clock budget is
            // exceeded, keeping every chunk well under 100 ms.
            if (performance.now() - chunkStart >= ENTITY_BUDGET_MS) {
                await yieldControl();
                chunkStart = performance.now();
            }
        } else {
            globalBackgroundProcessor.enqueue({
                id: `procedural_deferred_${i}`,
                execute: spawnExtra
            });
            deferredCount++;
        }
    }

    console.log(`[World] Procedural Extras: ${criticalCount} critical spawned, ${deferredCount} deferred.`);
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
            let obj: THREE.Object3D | null = null;

            if (type === 'flower') {
                obj = createFlower();
            } else if (type === 'mushroom') {
                obj = createMushroom({ size: 'regular', scale: 0.8 });
            }

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
