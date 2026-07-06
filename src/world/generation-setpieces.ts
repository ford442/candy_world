import * as THREE from 'three';
import { createIntegratedPollen, createIntegratedSparks, registerIntegratedSystem } from '../particles/index.ts';
import { makeInteractive } from '../utils/interaction-utils.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { spawnImpact } from '../foliage/impacts.ts';
import { safeAddFoliage } from './generation-entities.ts';
import {
    ARPEGGIO_GROVE, LAKE_ISLAND, WeatherSystem, yieldControl,
    ARPEGGIO_GROVE_FERN_COUNT, ARPEGGIO_GROVE_OUTER_COUNT,
    LAKE_ARPEGGIO_FERN_COUNT, LAKE_DANDELION_COUNT
} from './generation-utils.ts';
import { create, registerBuiltinWorldObjectTypes } from './foliage-registry.ts';
import { plantOnSurface, sampleGroundY } from './placement-utils.ts';

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
    plantOnSurface(centralLotus, centerX, centerZ);
    safeAddFoliage(centralLotus, false, 0, weatherSystem);
    await yieldControl();

    // Arpeggio Ferns ring (count controlled via CONFIG.world.population for faster Full mode loads)
    const fernCount = ARPEGGIO_GROVE_FERN_COUNT;
    const fernRadius = radius * 0.4;
    for (let i = 0; i < fernCount; i++) {
        const angle = (i / fernCount) * Math.PI * 2;
        const fx = centerX + Math.cos(angle) * fernRadius;
        const fz = centerZ + Math.sin(angle) * fernRadius;
        const fy = sampleGroundY(fx, fz);

        const fern = create('arpeggio_fern', { scale: 1.2 + Math.random() * 0.3 });
        if (!fern) continue;
        plantOnSurface(fern, fx, fz, { groundY: fy });
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
        const oy = sampleGroundY(ox, oz);

        if (i % 2 === 0) {
            const geyser = create('kick_drum_geyser', { maxHeight: 5.0 + Math.random() * 2.0 });
            if (!geyser) continue;
            plantOnSurface(geyser, ox, oz, { groundY: oy });
            geyser.rotation.y = angle;
            safeAddFoliage(geyser, false, 1.0, weatherSystem);
        } else {
            const violet = create('vibrato_violet', { intensity: 1.5 });
            if (!violet) continue;
            plantOnSurface(violet, ox, oz, { groundY: oy });
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
        const fy = sampleGroundY(fx, fz);

        const flower = create('flower', { variant: 'glowing' });
        if (!flower) continue;
        plantOnSurface(flower, fx, fz, { groundY: fy });
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
    plantOnSurface(centralMushroom, centerX, centerZ);
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
        const gy = sampleGroundY(gx, gz);

        const geyser = create('kick_drum_geyser', { maxHeight: 4.0 + Math.random() * 2.0 });
        if (!geyser) continue;
        plantOnSurface(geyser, gx, gz, { groundY: gy });
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
        const fy = sampleGroundY(fx, fz);

        const flower = i % 2 === 0
            ? create('vibrato_violet', { intensity: 1.2 })
            : create('tremolo_tulip', { size: 1.2 });
        if (!flower) continue;
        plantOnSurface(flower, fx, fz, { groundY: fy });
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
        const fy = sampleGroundY(fx, fz);

        const fern = create('arpeggio_fern', { scale: 0.8 + Math.random() * 0.4 });
        if (!fern) continue;
        plantOnSurface(fern, fx, fz, { groundY: fy });
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
        const dy = sampleGroundY(dx, dz);

        // Only place if we're still above water
        if (dy > 1.6) {
            const dandelion = create('cymbal_dandelion', { scale: 0.7 + Math.random() * 0.3 });
            if (!dandelion) continue;
            plantOnSurface(dandelion, dx, dz, { groundY: dy });
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
        const ty = sampleGroundY(tx, tz);

        const trap = create('snare_trap', { scale: 0.9 });
        if (!trap) continue;
        plantOnSurface(trap, tx, tz, { groundY: ty });
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
