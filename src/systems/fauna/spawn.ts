/**
 * Biome-weighted fauna spawning — places critters on authoritative ground surface.
 */

import * as THREE from 'three';
import { CONFIG } from '../../core/config.ts';
import { getGroundHeight, sampleGroundNormal } from '../ground-system.ts';
import { animatedFoliage } from '../../world/state.ts';
import { World } from '../ecs/world.ts';
import { faunaComponentCodec } from './components.ts';
import { getSkyIslandRoostAnchors, DEFAULT_ROOST_PLAN } from './roosts.ts';
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
    sky_islands: { beetle: 2, hopper: 2, moth: 9 },
    global: { beetle: 5, hopper: 4, moth: 4 },
};

/** Species mix used for sky-island roosts when CONFIG omits one. */
const DEFAULT_ROOST_DENSITY: FaunaBiomeDensity = { beetle: 1, hopper: 1, moth: 8 };

/**
 * Max |deckY - groundQueryY| tolerated before a roost anchor is rejected.
 *
 * The walkable platform registered for an island spans `[topY - 0.8, topY]`, so
 * a healthy query lands within ~1u of the registry's deck Y. A larger gap means
 * the platform never registered (placement failed, or the island was culled) and
 * the query fell through to terrain far below — dropping the anchor is what
 * keeps a roost from spawning in midair or inside the ground.
 */
const ROOST_DECK_TOLERANCE = 2.5;

/** Hover offset above the resolved surface, per species. */
function speciesHoverOffset(species: FaunaSpecies): number {
    if (species === FaunaSpecies.SugarMoth) return 2.5;
    if (species === FaunaSpecies.JellybeanHopper) return 0.22;
    return 0.14;
}

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

/** Shared writer for both spawn passes — keeps buffer layout in one place. */
function writeCritter(
    ctx: {
        world: World;
        buffer: Float32Array;
        base: number;
        rng: () => number;
        entries: FaunaSpawnEntry[];
    },
    slot: number,
    x: number,
    surfaceY: number,
    z: number,
    species: FaunaSpecies,
    biome: string
): void {
    const { world, buffer, base, rng, entries } = ctx;
    const normal = sampleGroundNormal(x, z, _scratchNormal);

    const b = base + slot * FAUNA_BOID_STRIDE;
    buffer[b] = x;
    buffer[b + 1] = surfaceY + speciesHoverOffset(species);
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
}

/**
 * Seat a flock on each registered sky-island deck (#1363 task 7).
 *
 * Runs before the terrain scatter so roosts are guaranteed a slice of the cap
 * rather than competing with ~58k m² of random samples. Returns the next free
 * slot; a no-op returning `startSlot` when roosts are disabled or no islands
 * are registered (CORE mode / `SKY_ISLANDS.enabled === false`).
 */
function spawnSkyIslandRoosts(
    ctx: {
        world: World;
        buffer: Float32Array;
        base: number;
        rng: () => number;
        entries: FaunaSpawnEntry[];
    },
    startSlot: number,
    maxCount: number
): number {
    const cfg = CONFIG.fauna?.roosts;
    if (cfg && cfg.enabled === false) return startSlot;

    const anchors = getSkyIslandRoostAnchors(
        {
            perIsland: cfg?.perIsland ?? DEFAULT_ROOST_PLAN.perIsland,
            ringInset: cfg?.ringInset ?? DEFAULT_ROOST_PLAN.ringInset,
            jitter: cfg?.jitter ?? DEFAULT_ROOST_PLAN.jitter,
        },
        ctx.rng
    );
    if (anchors.length === 0) return startSlot;

    const density = cfg?.density ?? DEFAULT_ROOST_DENSITY;
    let slot = startSlot;
    let rejected = 0;

    for (const anchor of anchors) {
        if (slot >= maxCount) break;

        // Resolve through the unified ground query so the deck comes from the
        // registered walkable platform, not the registry's cached Y (#1265).
        const surfaceY = getGroundHeight(anchor.x, anchor.z);
        if (Math.abs(surfaceY - anchor.y) > ROOST_DECK_TOLERANCE) {
            rejected++;
            continue;
        }

        const species = speciesForSlot(slot, density, ctx.rng);
        writeCritter(ctx, slot, anchor.x, surfaceY, anchor.z, species, 'sky_islands');
        slot++;
    }

    const placed = slot - startSlot;
    if (rejected > 0) {
        console.warn(
            `[Fauna] ${rejected}/${anchors.length} sky-island roosts skipped — deck not resolvable via ground query`
        );
    }
    if (placed > 0) {
        console.log(`[Fauna] Seated ${placed} roost critters across sky islands`);
    }
    return slot;
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
    const ctx = { world, buffer, base, rng, entries };

    // Reserved pass: sky-island roost flocks (#1363 task 7).
    let slot = spawnSkyIslandRoosts(ctx, 0, maxCount);

    // Terrain scatter fills whatever cap remains.
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

        writeCritter(ctx, slot, x, y, z, species, biome);
        slot++;
    }

    return entries;
}
