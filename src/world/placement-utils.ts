/**
 * @file src/world/placement-utils.ts
 * @brief Shared helpers for planting foliage / props on the authoritative ground surface.
 *
 * All batchers and world generators should use these helpers so object bases align
 * with terrain height at spawn time (no visible gaps or intersections at ground).
 */

import * as THREE from 'three';
import { getGroundHeight } from '../systems/ground-system.ts';

/** Local-origin Y offset from ground contact to object root (world units). */
export const ENTITY_BASE_OFFSETS: Readonly<Record<string, number>> = {
    mushroom: 0,
    glass_mushroom: 0,
    tree: 0,
    shrub: 0,
    flower: 0,
    rock: 0,
    grass: 0,
    portamento_pine: 0,
    arpeggio_fern: 0,
    luminous_plant: 0,
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
    return y;
}
