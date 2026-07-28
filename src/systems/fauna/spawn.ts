/**
 * Biome-weighted fauna spawning — places critters on authoritative ground surface.
 */

import * as THREE from 'three';
import { CONFIG } from '../../core/config.ts';
import { getGroundHeight, sampleGroundNormal } from '../ground-system.ts';
import { animatedFoliage } from '../../world/state.ts';
import { World } from '../ecs/world.ts';
import { faunaComponentCodec } from './components.ts';
import {
    FaunaSpecies,
    FaunaState,
    FAUNA_BOID_STRIDE,
    type FaunaBiomeDensity,
    type FaunaComponent,
    type FaunaSpawnEntry,
} from './types.ts';

const WORLD_MIN = -120;
const WORLD_MAX = 120;

const _scratchNormal = new THREE.Vector3();
const _scratchPos = new THREE.Vector3();

/** Default spawn density per biome (instances per 10k m² approx). */
const DEFAULT_BIOME_DENSITY: Record<string, FaunaBiomeDensity> = {
    arpeggio_grove: { beetle: 8, hopper: 6, moth: 4 },
    crystalline_nebula: { beetle: 4, hopper: 3, moth: 10 },
    luminous_plants: { beetle: 5, hopper: 4, moth: 8 },
    gem_canopy: { beetle: 6, hopper: 5, moth: 3 },
    lake_features: { beetle: 3, hopper: 2, moth: 5 },
    global: { beetle: 5, hopper: 4, moth: 4 },
};

function mulberry32(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function resolveBiomeAt(x: number, z: number): string {
    let bestBiome = 'global';
    let bestDist = Infinity;
    for (let i = 0; i < animatedFoliage.length; i++) {
        const obj = animatedFoliage[i];
        const biome = obj.userData?.biome as string | undefined;
        if (!biome) continue;
        obj.getWorldPosition(_scratchPos);
        const dx = _scratchPos.x - x;
        const dz = _scratchPos.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDist) {
            bestDist = d2;
            bestBiome = biome;
        }
    }
    return bestBiome;
}

function speciesForSlot(slot: number, density: FaunaBiomeDensity, rng: () => number): FaunaSpecies {
    const total = density.beetle + density.hopper + density.moth;
    if (total <= 0) return FaunaSpecies.GumdropBeetle;
    let pick = rng() * total;
    if (pick < density.beetle) return FaunaSpecies.GumdropBeetle;
    pick -= density.beetle;
    if (pick < density.hopper) return FaunaSpecies.JellybeanHopper;
    return FaunaSpecies.SugarMoth;
}

export interface SpawnFaunaOptions {
    world: World;
    buffer: Float32Array;
    bufferByteOffset: number;
    maxCount: number;
    seed?: number;
}

/**
 * Spawn fauna into ECS + dense boid buffer. Returns spawn entries for the batcher.
 */
export function spawnFaunaPopulation(opts: SpawnFaunaOptions): FaunaSpawnEntry[] {
    const { world, buffer, bufferByteOffset, maxCount } = opts;
    const rng = mulberry32(opts.seed ?? 0xc0ffee);
    const biomeDensity = CONFIG.fauna?.biomeDensity ?? DEFAULT_BIOME_DENSITY;
    const areaScale = (CONFIG.fauna?.areaScale ?? 1.0) * ((WORLD_MAX - WORLD_MIN) / 256);

    world.registerNativeComponent('fauna', faunaComponentCodec);

    const entries: FaunaSpawnEntry[] = [];
    const base = bufferByteOffset >> 2;
    let slot = 0;

    const attempts = maxCount * 4;
    for (let a = 0; a < attempts && slot < maxCount; a++) {
        const x = WORLD_MIN + rng() * (WORLD_MAX - WORLD_MIN);
        const z = WORLD_MIN + rng() * (WORLD_MAX - WORLD_MIN);
        const biome = resolveBiomeAt(x, z);
        const density = biomeDensity[biome] ?? biomeDensity.global ?? DEFAULT_BIOME_DENSITY.global;

        const spawnRoll = rng();
        const threshold = ((density.beetle + density.hopper + density.moth) / 30) * areaScale;
        if (spawnRoll > Math.min(0.85, threshold)) continue;

        const species = speciesForSlot(slot, density, rng);
        const y = getGroundHeight(x, z);
        const normal = sampleGroundNormal(x, z, _scratchNormal);

        const b = base + slot * FAUNA_BOID_STRIDE;
        buffer[b] = x;
        buffer[b + 1] =
            y +
            (species === FaunaSpecies.SugarMoth
                ? 2.5
                : species === FaunaSpecies.JellybeanHopper
                  ? 0.22
                  : 0.14);
        buffer[b + 2] = z;
        buffer[b + 3] = (rng() - 0.5) * 0.5;
        buffer[b + 4] = 0;
        buffer[b + 5] = (rng() - 0.5) * 0.5;
        buffer[b + 6] = rng() * Math.PI * 2;
        buffer[b + 7] = species;

        const entity = world.createEntity();
        const component: FaunaComponent = {
            slot,
            species,
            state: FaunaState.Wander,
            biome,
            normalX: normal.x,
            normalY: normal.y,
            normalZ: normal.z,
        };
        world.addComponent(entity, 'fauna', component);
        entries.push({ entity, component });
        slot++;
    }

    return entries;
}
