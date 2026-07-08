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
    mushroom: -0.15,
    glass_mushroom: -0.15,
    tree: -0.3,
    shrub: -0.1,
    flower: -0.05,
    rock: -0.2,
    grass: -0.05,
    portamento_pine: -0.3,
    arpeggio_fern: -0.1,
    luminous_plant: -0.1,
    gem_canopy_tree: -0.3,
    bubble_willow: -0.3,
};

export type PlacementMode = 'ground' | 'absolute' | 'offset';


const _scratchTx = new THREE.Vector3();
const _scratchTz = new THREE.Vector3();
const _scratchNormal = new THREE.Vector3();
const _upVector = new THREE.Vector3(0, 1, 0);

export function sampleGroundNormal(x: number, z: number, delta: number = 0.5): THREE.Vector3 {
    const hL = getGroundHeight(x - delta, z);
    const hR = getGroundHeight(x + delta, z);
    const hD = getGroundHeight(x, z - delta);
    const hU = getGroundHeight(x, z + delta);
    _scratchTx.set(delta * 2, hR - hL, 0).normalize();
    _scratchTz.set(0, hU - hD, delta * 2).normalize();
    _scratchNormal.crossVectors(_scratchTz, _scratchTx).normalize();
    return _scratchNormal;
}

const TILT_ENTITIES = ['mushroom', 'glass_mushroom', 'flower', 'shrub', 'grass', 'luminous_plant', 'rock'];
const WIDE_ENTITIES: Record<string, number> = {"tree":0.8,"rock":0.6,"portamento_pine":0.8,"gem_canopy_tree":0.8,"bubble_willow":0.8};

export function sampleGroundY(x: number, z: number): number {
    return getGroundHeight(x, z);
}


export function sampleMultiPointY(x: number, z: number, radius: number): number {
    const center = getGroundHeight(x, z);
    const px = getGroundHeight(x + radius, z);
    const nx = getGroundHeight(x - radius, z);
    const pz = getGroundHeight(x, z + radius);
    const nz = getGroundHeight(x, z - radius);
    return Math.min(center, px, nx, pz, nz);
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
    footprintRadius?: number;
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
    const groundY = options.groundY ?? (options.footprintRadius && options.footprintRadius > 0
        ? sampleMultiPointY(x, z, options.footprintRadius)
        : sampleGroundY(x, z));

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
    tiltToSlope?: boolean;
    footprintRadius?: number;
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
    let footprintRadius = options.footprintRadius;
    if (footprintRadius === undefined && entityType && WIDE_ENTITIES[entityType]) {
        footprintRadius = WIDE_ENTITIES[entityType];
    }

    const y = options.y
        ?? computePlacementY(x, z, {
            entityType,
            baseOffset: options.baseOffset,
            groundY: options.groundY,
            footprintRadius
        });
    obj.position.set(x, y, z);

    const shouldTilt = options.tiltToSlope || (entityType && TILT_ENTITIES.includes(entityType));
    if (shouldTilt) {
        const normal = sampleGroundNormal(x, z);
        // Limit tilt to ~25 degrees (cos(25) ≈ 0.906)
        if (normal.y < 0.906) {
            // Project normal onto XZ plane, scale it down to match y=0.906 while maintaining unit length
            const xzScale = Math.sqrt((1.0 - 0.906 * 0.906) / (normal.x * normal.x + normal.z * normal.z));
            normal.x *= xzScale;
            normal.z *= xzScale;
            normal.y = 0.906;
        }
        obj.quaternion.setFromUnitVectors(_upVector, normal);
    }

    return y;
}
