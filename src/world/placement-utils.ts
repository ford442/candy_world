/**
 * @file src/world/placement-utils.ts
 * @brief Shared helpers for planting foliage / props on the authoritative ground surface.
 *
 * All batchers and world generators should use these helpers so object bases align
 * with terrain height at spawn time (no visible gaps or intersections at ground).
 */

import * as THREE from 'three';
import { getGroundHeight, sampleGroundNormal, sampleGroundFootprint } from '../systems/ground-system.ts';
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
    // -------------------------------------------------------------------------
    // #1303 calibrated base offsets (world units, negative = sink, positive = raise).
    // All grounded archetypes below were audited against their batcher geometry:
    // the local origin is already the visual ground contact, so offsets are 0.
    // -------------------------------------------------------------------------

    // Mushrooms — stem bottom sits at local y=0 (unitCylinder scaled to stem height).
    mushroom: 0,
    retrigger_mushroom: 0,
    glass_mushroom: 0,

    // Generic tree / shrub fallback.
    tree: 0,
    shrub: 0,

    // Flowers — stem base at local y=0.
    flower: 0,
    glowing_flower: 0,
    starflower: 0,
    vibrato_violet: 0,
    tremolo_tulip: 0,
    cymbal_dandelion: 0,

    // Ground cover / props.
    rock: 0,
    grass: 0,

    // Tree archetypes — trunk cylinders translated [0,0.5,0] so base is at origin.
    portamento_pine: 0,
    bubble_willow: 0,
    balloon_bush: 0,
    helix_plant: 0,
    gem_canopy_tree: 0,

    // Ferns / luminous — merged geometry bottom at local y=0.
    arpeggio_fern: 0,
    luminous_plant: 0,

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

/**
 * Archetypes that should tilt to match the local terrain slope.
 * Slope alignment is applied as a quaternion stored on the logic object and
 * composed into the instance matrix by the relevant batchers.
 */
export const SLOPE_ALIGN_TYPES: Readonly<Set<string>> = new Set([
    'tree',
    'shrub',
    'portamento_pine',
    'bubble_willow',
    'balloon_bush',
    'helix_plant',
    'gem_canopy_tree',
    'arpeggio_fern',
    'luminous_plant',
]);

/**
 * Per-type footprint radius (world units) used for wide props.
 * A circular footprint of this radius is sampled; the lowest contact point is
 * used so the prop never floats above uneven ground.
 */
export const FOOTPRINT_RADIUS: Readonly<Record<string, number>> = {
    // Wide tree / shrub canopies with broad bases.
    tree: 0.4,
    shrub: 0.4,
    portamento_pine: 0.5,
    bubble_willow: 0.6,
    balloon_bush: 0.6,
    helix_plant: 0.4,
    gem_canopy_tree: 0.6,

    // Large props that need stable contact.
    subwoofer_lotus: 0.7,
    kick_drum_geyser: 0.5,
    snare_trap: 0.5,
    instrument_shrine: 0.6,

    // Mushrooms: caps overhang, so footprint is smaller and slope alignment is off.
    mushroom: 0.25,
    retrigger_mushroom: 0.35,
    glass_mushroom: 0.25,

    // Ground cover.
    rock: 0.3,
    grass: 0.15,
};

/** Number of perimeter points sampled around a footprint. */
export const FOOTPRINT_SAMPLES = 8;

/** Clamp slope alignment so props never approach horizontal/vertical. */
export const MAX_SLOPE_ANGLE = Math.PI / 4;

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
 *
 * Note: this helper samples a single point. For wide props, plantOnSurface()
 * performs a footprint-aware multi-point sample instead.
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

const _up = new THREE.Vector3(0, 1, 0);
const _identityQuat = new THREE.Quaternion();

function clampGroundNormal(normal: THREE.Vector3): THREE.Vector3 {
    // Clamp the angle between the normal and world up to MAX_SLOPE_ANGLE.
    const minY = Math.cos(MAX_SLOPE_ANGLE);
    if (normal.y < minY) {
        normal.y = minY;
        normal.normalize();
    }
    return normal;
}

function computeSlopeQuaternion(normal: THREE.Vector3): THREE.Quaternion {
    const clamped = clampGroundNormal(normal.clone());
    if (clamped.y > 0.9999) return _identityQuat.clone();
    const q = new THREE.Quaternion().setFromUnitVectors(_up, clamped);
    return q;
}

/**
 * Return the final instance quaternion for a logic object, combining the caller's
 * yaw (obj.quaternion) with any terrain-slope tilt stored on userData.
 */
export function getGroundAlignedQuaternion(
    obj: THREE.Object3D,
    out: THREE.Quaternion = new THREE.Quaternion()
): THREE.Quaternion {
    const slope = obj.userData.groundSlopeQuaternion as THREE.Quaternion | undefined;
    if (!slope) return out.copy(obj.quaternion);
    return out.multiplyQuaternions(slope, obj.quaternion);
}

/**
 * Position an object so its base sits on the authoritative ground at (x, z).
 * Supports multi-point footprint sampling and slope-aware alignment for
 * configured archetypes. Returns the applied world Y.
 */
export function plantOnSurface(
    obj: THREE.Object3D,
    x: number,
    z: number,
    options: PlantOnSurfaceOptions = {}
): number {
    const entityType = (obj.userData.mapEntityType ?? obj.userData.type) as string | undefined;
    const baseOffset = options.baseOffset
        ?? getEntityBaseOffset(entityType);

    let y: number;
    let normal: THREE.Vector3;
    const footprintRadius = entityType ? (FOOTPRINT_RADIUS[entityType] ?? 0) : 0;

    if (footprintRadius > 0) {
        const footprint = sampleGroundFootprint(x, z, footprintRadius, FOOTPRINT_SAMPLES);
        y = footprint.minY + baseOffset;
        normal = footprint.normal;
    } else {
        const groundY = options.groundY ?? sampleGroundY(x, z);
        y = options.y ?? (groundY + baseOffset);
        normal = sampleGroundNormal(x, z);
    }

    if (entityType && SLOPE_ALIGN_TYPES.has(entityType)) {
        const slopeQ = computeSlopeQuaternion(normal);
        obj.userData.groundSlopeQuaternion = slopeQ;
        obj.userData.groundNormal = normal.clone();
    } else {
        obj.userData.groundSlopeQuaternion = undefined;
        obj.userData.groundNormal = normal.clone();
    }

    obj.userData.footprintRadius = footprintRadius > 0 ? footprintRadius : undefined;
    obj.position.set(x, y, z);
    registerPlantedInstance(x, y, z, entityType, footprintRadius || undefined, normal);
    return y;
}
