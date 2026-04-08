/**
 * @file culling-types.ts
 * @description Types, enums, constants and utility functions for the culling system
 * 
 * Defines the core data structures and shared utilities used by the culling system.
 */

import * as THREE from 'three';

// ============================================================================
// ENUMS
// ============================================================================

/** Culling groups for different update frequencies */
export enum CullingGroup {
    /** Static objects: terrain, buildings (cull once, cache) */
    STATIC = 'static',
    /** Dynamic objects: moving objects (cull every frame) */
    DYNAMIC = 'dynamic',
    /** Always visible: player, nearby interactables */
    ALWAYS_VISIBLE = 'always_visible'
}

/** Entity types with specific culling parameters */
export enum EntityType {
    TREE = 'tree',
    MUSHROOM = 'mushroom',
    FLOWER = 'flower',
    PARTICLE = 'particle',
    CLOUD = 'cloud',
    TERRAIN = 'terrain',
    BUILDING = 'building',
    PLAYER = 'player',
    INTERACTABLE = 'interactable',
    GENERIC = 'generic'
}

/** LOD levels for mesh detail switching */
export enum LODLevel {
    FULL = 0,      // 0-20m: Full detail
    MEDIUM = 1,    // 20-50m: Medium (50% vertices)
    LOW = 2,       // 50-100m: Low (25% vertices)
    BILLBOARD = 3  // 100m+: Billboard/impostor
}

/** Quality tiers for distance culling */
export enum QualityTier {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    ULTRA = 'ultra'
}

// ============================================================================
// INTERFACES
// ============================================================================

/** Cullable object interface */
export interface CullableObject {
    id: string;
    object: THREE.Object3D;
    entityType: EntityType;
    group: CullingGroup;
    boundingSphere: THREE.Sphere;
    lodMeshes?: Map<LODLevel, THREE.Mesh>;
    currentLOD?: LODLevel;
    occlusionQueryId?: number;
    lastOcclusionResult?: boolean;
    occlusionFrames?: number;
    fadeAlpha?: number;
    visible?: boolean;
    distance?: number;
    staticCached?: boolean;
}

/** Culling configuration options */
export interface CullingConfig {
    /** Quality tier for distance adjustments */
    qualityTier: QualityTier;
    /** Enable frustum culling */
    enableFrustumCulling: boolean;
    /** Enable occlusion culling (WebGPU only) */
    enableOcclusionCulling: boolean;
    /** Enable distance-based culling */
    enableDistanceCulling: boolean;
    /** Enable LOD switching */
    enableLOD: boolean;
    /** Frustum culling margin (prevents popping at edges) */
    frustumMargin: number;
    /** Spatial hash grid cell size */
    gridCellSize: number;
    /** Debug visualization enabled */
    debugMode: boolean;
    /** Maximum occlusion query age before retest */
    maxOcclusionFrames: number;
    /** Smooth LOD transition distance */
    lodTransitionDistance: number;
    /** Use dithering for fade transitions */
    useDithering: boolean;
}

/** Culling statistics */
export interface CullingStats {
    /** Total registered objects */
    totalObjects: number;
    /** Currently visible objects */
    visibleObjects: number;
    /** Objects culled this frame */
    culledObjects: number;
    /** Culling computation time in ms */
    cullingTimeMs: number;
    /** Frustum culled count */
    frustumCulled: number;
    /** Distance culled count */
    distanceCulled: number;
    /** Occlusion culled count */
    occlusionCulled: number;
    /** LOD switches this frame */
    lodSwitches: number;
    /** Spatial hash grid cells checked */
    gridCellsChecked: number;
}

/** LOD level configuration */
export interface LODLevelConfig {
    min: number;
    max: number;
}

/** Spatial hash grid configuration */
export interface SpatialHashConfig {
    cellSize: number;
}

/** Occlusion query configuration */
export interface OcclusionQueryConfig {
    maxOcclusionFrames: number;
    renderer?: any;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default culling distances per entity type (in meters) */
export const DEFAULT_CULL_DISTANCES: Record<EntityType, number> = {
    [EntityType.TREE]: 150,
    [EntityType.MUSHROOM]: 80,
    [EntityType.FLOWER]: 50,
    [EntityType.PARTICLE]: 30,
    [EntityType.CLOUD]: 200,
    [EntityType.TERRAIN]: 500,
    [EntityType.BUILDING]: 300,
    [EntityType.PLAYER]: Infinity,
    [EntityType.INTERACTABLE]: 100,
    [EntityType.GENERIC]: 100
};

/** LOD distance thresholds */
export const LOD_THRESHOLDS: Record<LODLevel, LODLevelConfig> = {
    [LODLevel.FULL]: { min: 0, max: 20 },
    [LODLevel.MEDIUM]: { min: 20, max: 50 },
    [LODLevel.LOW]: { min: 50, max: 100 },
    [LODLevel.BILLBOARD]: { min: 100, max: Infinity }
};

/** Quality tier multipliers for distances */
export const QUALITY_MULTIPLIERS: Record<QualityTier, number> = {
    [QualityTier.LOW]: 0.5,
    [QualityTier.MEDIUM]: 0.75,
    [QualityTier.HIGH]: 1.0,
    [QualityTier.ULTRA]: 1.5
};

/** Distance multipliers (alias for QUALITY_MULTIPLIERS) */
export const DISTANCE_MULTIPLIERS = QUALITY_MULTIPLIERS;

/** Default culling configuration */
export const DEFAULT_CULLING_CONFIG: CullingConfig = {
    qualityTier: QualityTier.HIGH,
    enableFrustumCulling: true,
    enableOcclusionCulling: false, // WebGPU only
    enableDistanceCulling: true,
    enableLOD: true,
    frustumMargin: 2.0,
    gridCellSize: 50,
    debugMode: false,
    maxOcclusionFrames: 5,
    lodTransitionDistance: 5.0,
    useDithering: true
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/** Generate a dithering value for smooth LOD transitions */
export function getDitherValue(screenX: number, screenY: number, pattern: number[]): number {
    const x = Math.floor(screenX) % 4;
    const y = Math.floor(screenY) % 4;
    return pattern[y * 4 + x];
}

/** Create LOD meshes for an object with different detail levels */
export function createLODMeshes(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    detailLevels: { level: LODLevel; vertexPercent: number }[] = [
        { level: LODLevel.FULL, vertexPercent: 1.0 },
        { level: LODLevel.MEDIUM, vertexPercent: 0.5 },
        { level: LODLevel.LOW, vertexPercent: 0.25 },
        { level: LODLevel.BILLBOARD, vertexPercent: 0.0 }
    ]
): Map<LODLevel, THREE.Mesh> {
    const lodMeshes = new Map<LODLevel, THREE.Mesh>();

    for (const { level, vertexPercent } of detailLevels) {
        if (level === LODLevel.BILLBOARD) {
            // Create billboard/impostor for far distances
            const billboardGeo = new THREE.PlaneGeometry(2, 2);
            const billboard = new THREE.Mesh(billboardGeo, material);
            billboard.userData.isBillboard = true;
            lodMeshes.set(level, billboard);
        } else if (vertexPercent < 1.0) {
            // Simplified geometry
            const simplifiedGeo = simplifyGeometry(geometry, vertexPercent);
            const mesh = new THREE.Mesh(simplifiedGeo, material);
            lodMeshes.set(level, mesh);
        } else {
            // Full detail
            const mesh = new THREE.Mesh(geometry, material);
            lodMeshes.set(level, mesh);
        }
    }

    return lodMeshes;
}

/** Simplify geometry by reducing vertices (placeholder implementation) */
export function simplifyGeometry(geometry: THREE.BufferGeometry, targetPercent: number): THREE.BufferGeometry {
    // In a real implementation, this would use a decimation algorithm
    // For now, we just return the original geometry
    // Libraries like '@gltf-transform/functions' or custom decimation could be used
    
    if (targetPercent >= 1.0 || !geometry.attributes.position) {
        return geometry.clone();
    }

    const positions = geometry.attributes.position.array as Float32Array;
    const vertexCount = positions.length / 3;
    const targetCount = Math.max(3, Math.floor(vertexCount * targetPercent));
    
    // Simple vertex skipping for demonstration
    // Real implementation should use proper mesh decimation
    const skipFactor = Math.ceil(vertexCount / targetCount);
    const newPositions: number[] = [];
    const newNormals: number[] = [];
    const newUvs: number[] = [];
    
    const hasNormals = geometry.attributes.normal !== undefined;
    const hasUvs = geometry.attributes.uv !== undefined;
    
    const normals = hasNormals ? (geometry.attributes.normal.array as Float32Array) : null;
    const uvs = hasUvs ? (geometry.attributes.uv.array as Float32Array) : null;
    
    for (let i = 0; i < vertexCount; i += skipFactor) {
        const idx = i * 3;
        newPositions.push(positions[idx], positions[idx + 1], positions[idx + 2]);
        
        if (hasNormals && normals) {
            newNormals.push(normals[idx], normals[idx + 1], normals[idx + 2]);
        }
        if (hasUvs && uvs) {
            const uvIdx = i * 2;
            newUvs.push(uvs[uvIdx], uvs[uvIdx + 1]);
        }
    }
    
    const simplified = new THREE.BufferGeometry();
    simplified.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    
    if (hasNormals) {
        simplified.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
    }
    if (hasUvs) {
        simplified.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
    }
    
    return simplified;
}
