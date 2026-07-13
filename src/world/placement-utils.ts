/**
 * @file src/world/placement-utils.ts
 * @brief Shared helpers for planting foliage / props on the authoritative ground surface.
 *
 * All batchers and world generators should use these helpers so object bases align
 * with terrain height at spawn time (no visible gaps or intersections at ground).
 */

export { sampleEntityScale, sampleEntityHeight, biomeNormalizedDistance } from './entity-scale.ts';
export type { ScaleSampleOptions } from './entity-scale.ts';
import * as THREE from 'three';
import { CONFIG } from '../core/config.ts';
import { getGroundHeight, sampleGroundNormal, sampleGroundFootprint, type GroundFootprintResult } from '../systems/ground-system.ts';
import { registerPlantedInstance } from '../debug/ground-debug.ts';

/**
 * Local-origin Y offset from ground contact to object root (world units).
 * Added to authoritative ground Y in plantOnSurface() / computePlacementY().
 * Negative = sink into terrain; positive = raise root above sampled ground.
 *
 * Values audited against batcher merged geometry minY (see tools/audit-base-offsets.mjs).
 */
export const ENTITY_BASE_OFFSETS: Readonly<Record<string, number>> = {
    // --- Mushrooms (mushroom-batcher / glass-mushroom-batcher) ---
    // Stem pivot minY=0; slight sink so cap overhang reads rooted.
    mushroom: -0.02,
    retrigger_mushroom: -0.02, // stem cylinder bottom at local y=0 (musical_flora.ts)
    glass_mushroom: 0,         // glass-mushroom-batcher merged geo minY=0

    // --- Trees / shrubs (tree-batcher / portamento-batcher) ---
    tree: 0,                   // unitCylinder trunk base at origin
    shrub: 0,                  // balloon_bush lowest sphere sits on y=0
    portamento_pine: 0,        // portamento-batcher merged trunk minY=0
    bubble_willow: 0,          // trunk.position.y=h/2 → base at group origin
    balloon_bush: 0,
    helix_plant: 0.02,         // TubeGeometry tube radius extends ~2cm below t=0
    gem_canopy_tree: 0,        // bubble-willow silhouette; hit cylinder base at origin
    prism_rose_bush: 0,        // trunk unitCylinder scaled from y=0

    // --- Ferns / luminous ---
    arpeggio_fern: 0,          // arpeggio-batcher merged minY=0
    luminous_plant: 0,         // luminous-plant-batcher stem translate(0,2,0) → minY=0

    // --- Flowers ---
    flower: 0,
    glowing_flower: 0,
    starflower: 0,
    vibrato_violet: 0,
    tremolo_tulip: 0,
    cymbal_dandelion: 0,       // dandelion-batcher stem translate(0,0.75,0) on h=1.5

    // --- Ground cover ---
    rock: -0.04,               // embed slightly for natural scatter
    grass: -0.015,

    // --- Musical / interactive props ---
    kick_drum_geyser: 0.08,    // coreGeo minY≈−0.1 (translate −0.05, h=0.1)
    snare_trap: 0,             // lower jaw box bottom at y=0
    subwoofer_lotus: 0,        // pad unitCylinder minY=0
    panning_pad: 0,
    instrument_shrine: 0,
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
 * A circular footprint of this radius is sampled; placement Y follows
 * {@link resolveFootprintGroundY} (lowest contact by default).
 *
 * @deprecated Prefer `CONFIG.ground.footprintRadius` — kept for grep/docs compatibility.
 */
export const FOOTPRINT_RADIUS: Readonly<Record<string, number>> = CONFIG.ground.footprintRadius;

/** @deprecated Prefer `CONFIG.ground.footprintSamples`. */
export const FOOTPRINT_SAMPLES = CONFIG.ground.footprintSamples;

/** @deprecated Prefer `CONFIG.ground.maxSlopeAngle`. */
export const MAX_SLOPE_ANGLE = CONFIG.ground.maxSlopeAngle;

export function getFootprintSamples(): number {
    return CONFIG.ground.footprintSamples;
}

export function getEntityFootprintRadius(entityType?: string): number {
    if (!entityType) return 0;
    return CONFIG.ground.footprintRadius[entityType] ?? 0;
}

export function getMaxSlopeAngle(): number {
    return CONFIG.ground.maxSlopeAngle;
}

/** Pick placement Y from a footprint sample based on per-type policy. */
export function resolveFootprintGroundY(footprint: GroundFootprintResult, entityType?: string): number {
    const policy = entityType ? CONFIG.ground.footprintPlacementY[entityType] : undefined;
    return policy === 'avg' ? footprint.avgY : footprint.minY;
}

export type PlacementMode = 'ground' | 'absolute' | 'offset';

export function sampleGroundY(x: number, z: number): number {
    return getGroundHeight(x, z);
}

export function getEntityBaseOffset(entityType?: string): number {
    if (!entityType) return 0;
    return ENTITY_BASE_OFFSETS[entityType] ?? 0;
}

/** Resolve per-entity base offset: explicit override → map.json → type table. */
export function resolveEntityBaseOffset(
    entityType: string | undefined,
    overrides?: { baseOffset?: number }
): number {
    if (overrides?.baseOffset !== undefined && Number.isFinite(overrides.baseOffset)) {
        return overrides.baseOffset;
    }
    return getEntityBaseOffset(entityType);
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
 * Wide props with a configured footprint radius use multi-point sampling automatically.
 */
export function computePlacementY(
    x: number,
    z: number,
    options: ComputePlacementYOptions = {}
): number {
    const mode = options.mode ?? 'ground';
    const entityType = options.entityType;
    const footprintRadius = getEntityFootprintRadius(entityType);

    let groundY = options.groundY;
    if (groundY === undefined) {
        if (footprintRadius > 0) {
            const footprint = sampleGroundFootprint(x, z, footprintRadius, getFootprintSamples());
            groundY = resolveFootprintGroundY(footprint, entityType);
        } else {
            groundY = sampleGroundY(x, z);
        }
    }

    if (mode === 'absolute') {
        return options.yInput ?? groundY;
    }
    if (mode === 'offset') {
        return groundY + (options.yInput ?? 0);
    }

    const baseOffset = options.baseOffset
        ?? getEntityBaseOffset(entityType);
    return groundY + baseOffset;
}

export interface PlantOnSurfaceOptions {
    groundY?: number;
    baseOffset?: number;
    y?: number;
    /** Override entity type when mapEntityType is not yet stamped on userData. */
    entityType?: string;
    /** Override per-type slope opt-in (default: SLOPE_ALIGN_TYPES). */
    alignToSlope?: boolean;
    /** Max tilt from world-up in radians (default: MAX_SLOPE_ANGLE ≈ 25°). */
    maxTiltRadians?: number;
}

const _up = new THREE.Vector3(0, 1, 0);
const _scratchClampNormal = new THREE.Vector3();
const _scratchSlopeQuat = new THREE.Quaternion();

function clampGroundNormal(normal: THREE.Vector3, maxTiltRadians: number): void {
    const minY = Math.cos(maxTiltRadians);
    if (normal.y < minY) {
        normal.y = minY;
        normal.normalize();
    }
}

function computeSlopeQuaternion(
    normal: THREE.Vector3,
    maxTiltRadians: number,
    out: THREE.Quaternion = _scratchSlopeQuat
): THREE.Quaternion {
    _scratchClampNormal.copy(normal);
    clampGroundNormal(_scratchClampNormal, maxTiltRadians);
    if (_scratchClampNormal.y > 0.9999) return out.identity();
    return out.setFromUnitVectors(_up, _scratchClampNormal);
}

function shouldAlignToSlope(entityType: string | undefined, alignToSlope?: boolean): boolean {
    if (alignToSlope === true) return true;
    if (alignToSlope === false) return false;
    return !!entityType && SLOPE_ALIGN_TYPES.has(entityType);
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
    const entityType = (options.entityType
        ?? obj.userData.mapEntityType
        ?? obj.userData.type) as string | undefined;
    const mapParamOffset = typeof obj.userData.mapExport?.params?.baseOffset === 'number'
        ? obj.userData.mapExport.params.baseOffset as number
        : undefined;
    const userOffset = typeof obj.userData.baseOffset === 'number'
        ? obj.userData.baseOffset as number
        : undefined;
    const baseOffset = resolveEntityBaseOffset(entityType, {
        baseOffset: options.baseOffset ?? userOffset ?? mapParamOffset,
    });

    let y: number;
    let normal: THREE.Vector3;
    const footprintRadius = getEntityFootprintRadius(entityType);

    if (footprintRadius > 0) {
        const footprint = sampleGroundFootprint(x, z, footprintRadius, getFootprintSamples());
        y = resolveFootprintGroundY(footprint, entityType) + baseOffset;
        normal = footprint.normal;
    } else {
        const groundY = options.groundY ?? sampleGroundY(x, z);
        y = options.y ?? (groundY + baseOffset);
        normal = sampleGroundNormal(x, z);
    }

    const maxTilt = options.maxTiltRadians ?? getMaxSlopeAngle();
    const alignSlope = shouldAlignToSlope(entityType, options.alignToSlope);

    if (alignSlope) {
        obj.userData.groundSlopeQuaternion = computeSlopeQuaternion(normal, maxTilt, new THREE.Quaternion());
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
