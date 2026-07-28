/**
 * Fauna ECS component types — ambient candy critters (beetles, hoppers, moths).
 */

import type { Entity } from '../ecs/types.ts';

/** Species id — matches assembly/boids.ts species field (f32 slot 7). */
export enum FaunaSpecies {
    GumdropBeetle = 0,
    JellybeanHopper = 1,
    SugarMoth = 2,
}

/** High-level behaviour state (future expansion). */
export enum FaunaState {
    Wander = 0,
    Flee = 1,
    Rest = 2,
}

/** Dense-buffer stride in floats (mirrors assembly/boids.ts). */
export const FAUNA_BOID_STRIDE = 8;

/** ECS `fauna` component — maps entity → simulation slot + metadata. */
export interface FaunaComponent {
    /** Index into the shared Float32Array boid slab. */
    slot: number;
    species: FaunaSpecies;
    state: FaunaState;
    /** Biome tag for music-reactive tinting (matches foliage userData.biome). */
    biome: string;
    /** Cached ground normal for tilt (xyz). */
    normalX: number;
    normalY: number;
    normalZ: number;
}

export interface FaunaSpawnEntry {
    entity: Entity;
    component: FaunaComponent;
}

export interface FaunaBiomeDensity {
    beetle: number;
    hopper: number;
    moth: number;
}
