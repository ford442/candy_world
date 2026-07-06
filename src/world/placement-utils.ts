/**
 * @file src/world/placement-utils.ts
 * @brief Shared helpers for planting foliage / props on the authoritative ground surface.
 *
 * All batchers and world generators should use these helpers so object bases align
 * with terrain height at spawn time (no visible gaps or intersections at ground).
 */

import * as THREE from 'three';
import { getGroundHeight } from '../systems/ground-system.ts';
import { registerPlantedInstance } from '../debug/ground-debug.ts';

/**
 * Local-origin Y offset from ground contact to object root (world units).
 *
 * Most candy-world geometry is already authored with its pivot at the visual base
 * (unitCylinder/unitCone/unitSphere translated so y=0 is the ground contact), so
 * the majority of entries are 0. Offsets here are for species whose authored pivot
 * sits above or below the contact point, or for props that need a small sink/raise
 * for visual grounding.
 */
export const ENTITY_BASE_OFFSETS: Readonly<Record<string, number>> = {
    // Standard flora — geometry pivots at ground contact.
    mushroom: 0,
    retrigger_mushroom: 0,
    glass_mushroom: 0,
    tree: 0,
    shrub: 0,
    flower: 0,
    glowing_flower: 0,
    starflower: 0,
    vibrato_violet: 0,
    tremolo_tulip: 0,
    cymbal_dandelion: 0,
    rock: 0,
    grass: 0,
    portamento_pine: 0,
    arpeggio_fern: 0,
    luminous_plant: 0,

    // Tree / bush archetypes registered via foliage-registry.
    bubble_willow: 0,
    balloon_bush: 0,
    helix_plant: 0,
    gem_canopy_tree: 0,

    // Musical / interactive props — anchored at base.
    kick_drum_geyser: 0,
    snare_trap: 0,
    subwoofer_lotus: 0,
    panning_pad: 0,
    instrument_shrine: 0,

    // Floating / hanging props intentionally not grounded (handled by placement logic).
    // cloud: 0,
    // floating_orb: 0,
    // wisteria_cluster: 0,
};

export type PlacementMode = 'ground' | 'absolute' | 'offset';

export function sampleGroundY(x: number, z: number): number {
    return getGroundHeight(x, z);
}

export function getEntityBaseOffset(entityType?: string): number {
    if (!entityType) return 0;
    return ENTITY_BASE_OFFSETS[entityType] ?? 0;
}

export interface ComputePlacementYOptions {
    mode?: PlacementMode;
    yInput?: number;
    entityType?: string;
    baseOffset?: number;
    groundY?: number;
}

/**
 * Compute the world Y for an entity given placement mode and optional overrides.
 */
export function computePlacementY(
    x: number,
    z: number,
    options: ComputePlacementYOptions = {}
): number {
    const mode = options.mode ?? 'ground';
    const groundY = options.groundY ?? sampleGroundY(x, z);

    if (mode === 'absolute') {
        return options.yInput ?? groundY;
    }
    if (mode === 'offset') {
        return groundY + (options.yInput ?? 0);
    }

    const baseOffset = options.baseOffset
        ?? getEntityBaseOffset(options.entityType);
    return groundY + baseOffset;
}

export interface PlantOnSurfaceOptions {
    groundY?: number;
    baseOffset?: number;
    y?: number;
}

/**
 * Position an object so its base sits on the authoritative ground at (x, z).
 * Returns the applied world Y.
 */
export function plantOnSurface(
    obj: THREE.Object3D,
    x: number,
    z: number,
    options: PlantOnSurfaceOptions = {}
): number {
    const entityType = (obj.userData.mapEntityType ?? obj.userData.type) as string | undefined;
    const y = options.y
        ?? computePlacementY(x, z, {
            entityType,
            baseOffset: options.baseOffset,
            groundY: options.groundY,
        });
    obj.position.set(x, y, z);
    registerPlantedInstance(x, y, z, entityType);
    return y;
}
