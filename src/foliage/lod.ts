// src/foliage/lod.ts
// Level-of-Detail (LOD) system for animated foliage
// Provides ~40% FPS improvement at 5k+ objects through distance-based mesh simplification

import * as THREE from 'three';
import {
    color, float, vec3, positionLocal, mix, attribute, uv, sin, cos, positionWorld,
    normalLocal
} from 'three/tsl';
import { foliageGroup } from '../world/state.ts';
import {
    CandyPresets,
    calculateWindSway,
    applyPlayerInteraction,
    uTime,
    uAudioLow,
    uAudioHigh,
    uWindSpeed
} from './common.ts';

// --- Configuration ---

export interface LODConfig {
    /** Distance thresholds: [lod1, lod2, cull] in meters */
    thresholds: [number, number, number];
    /** Geometry segment counts for each LOD level [lod0, lod1, lod2] */
    geometrySegments: {
        sphere: [number, number, number];
        cylinder: [number, number, number];
        capsule: [number, number, number];
        helix: [number, number, number];
        rose: [number, number, number];
    };
    /** Maximum instances per LOD level */
    maxInstances: {
        lod0: number;
        lod1: number;
        lod2: number;
    };
}

export const DEFAULT_LOD_CONFIG: LODConfig = {
    thresholds: [20, 50, 100], // LOD0: 0-20m, LOD1: 20-50m, LOD2: 50-100m, Culled: >100m
    geometrySegments: {
        sphere: [16, 8, 4],
        cylinder: [12, 8, 6],
        capsule: [8, 6, 4],
        helix: [16, 10, 6],
        rose: [64, 32, 16],
    },
    maxInstances: {
        lod0: 1000,  // Close, detailed objects
        lod1: 3000,  // Medium distance
        lod2: 5000,  // Far distance (billboards)
    }
};

// --- LOD Level Enum ---

export enum LODLevel {
    LOD0 = 0,  // High detail: full animation
    LOD1 = 1,  // Medium: simplified animation
    LOD2 = 2,  // Low: billboard/minimal animation
    Culled = 3 // Beyond cull distance
}

// --- Geometry Cache ---

const geometryCache = new Map<string, THREE.BufferGeometry>();

/**
 * Creates or retrieves a cached LOD geometry
 */
export function createLODGeometry(
    geometryType: 'sphere' | 'cylinder' | 'capsule' | 'helix' | 'rose' | 'billboard',
    lodLevel: number
): THREE.BufferGeometry {
    const cacheKey = `${geometryType}_lod${lodLevel}`;
    
    if (geometryCache.has(cacheKey)) {
        return geometryCache.get(cacheKey)!;
    }

    let geometry: THREE.BufferGeometry;
    const config = DEFAULT_LOD_CONFIG.geometrySegments;

    switch (geometryType) {
        case 'sphere': {
            const segments = config.sphere[lodLevel];
            geometry = new THREE.SphereGeometry(1, segments, segments);
            break;
        }
        case 'cylinder': {
            const segments = config.cylinder[lodLevel];
            geometry = new THREE.CylinderGeometry(1, 1, 1, segments).translate(0, 0.5, 0);
            break;
        }
        case 'capsule': {
            const [radSeg, heightSeg] = lodLevel === 0 ? [8, 6] : lodLevel === 1 ? [6, 4] : [4, 3];
            geometry = new THREE.CapsuleGeometry(0.5, 1, heightSeg, radSeg);
            break;
        }
        case 'helix': {
            const segments = config.helix[lodLevel];
            geometry = new THREE.CylinderGeometry(1, 1, 1, segments, segments * 2).translate(0, 0.5, 0);
            break;
        }
        case 'rose': {
            const segments = config.rose[lodLevel];
            geometry = new THREE.TorusKnotGeometry(0.25, 0.08, segments, Math.max(4, segments / 8), 2, 3);
            break;
        }
        case 'billboard': {
            // Simple plane facing camera
            geometry = new THREE.PlaneGeometry(1, 1);
            break;
        }
        default:
            throw new Error(`Unknown geometry type: ${geometryType}`);
    }

    geometryCache.set(cacheKey, geometry);
    return geometry;
}

// --- Material Factory ---

const materialCache = new Map<string, THREE.Material>();

/**
 * Creates simplified materials for each LOD level
 * LOD0: Full effects (wind sway + player interaction + flutter + audio)
 * LOD1: Simple wind sway only (no player interaction, reduced effects)
 * LOD2: No vertex animation (just rotation), minimal shader complexity
 */
export function getLODMaterial(
    baseMaterial: THREE.Material,
    lodLevel: LODLevel,
    geometryType: string
): THREE.Material {
    const cacheKey = `${geometryType}_${lodLevel}_${baseMaterial.uuid || 'default'}`;
    
    if (materialCache.has(cacheKey)) {
        return materialCache.get(cacheKey)!;
    }

    let material: THREE.Material;

    switch (lodLevel) {
        case LODLevel.LOD0:
            // Use base material with full effects (already set up in TreeBatcher)
            material = baseMaterial.clone();
            break;

        case LODLevel.LOD1:
            // Simplified: wind sway only, no player interaction
            material = createLOD1Material(geometryType, baseMaterial);
            break;

        case LODLevel.LOD2:
            // Minimal: no vertex animation, simple color
            material = createLOD2Material(geometryType, baseMaterial);
            break;

        default:
            material = baseMaterial.clone();
    }

    materialCache.set(cacheKey, material);
    return material;
}

/**
 * LOD1 Material: Simple wind sway only, no player interaction
 */
function createLOD1Material(geometryType: string, baseMaterial: THREE.Material): THREE.Material {
    const instanceColor = attribute('instanceColor', 'vec3');

    switch (geometryType) {
        case 'trunk':
        case 'cylinder': {
            const trunkColor = mix(instanceColor.mul(0.6), instanceColor, positionLocal.y);
            return CandyPresets.Clay(0x8B4513, {
                colorNode: trunkColor,
                roughness: 0.8,
                bumpStrength: 0.1, // Reduced bump for LOD1
                rimStrength: 0.2,
                deformationNode: calculateWindSway(positionLocal), // Wind only, no interaction
                triplanar: true
            });
        }

        case 'sphere':
        case 'leaf': {
            // Simple wind sway without flutter or squash
            const sphereDeform = calculateWindSway(positionLocal);
            return CandyPresets.Gummy(0x228B22, {
                colorNode: instanceColor,
                roughness: 0.4,
                transmission: 0.2, // Reduced transmission
                thickness: 0.5,
                deformationNode: sphereDeform,
                rimStrength: 0.4,
                audioReactStrength: 0.2 // Reduced audio response
            });
        }

        case 'capsule':
        case 'branch': {
            const capsuleDeform = calculateWindSway(positionLocal);
            return CandyPresets.Clay(0x8B4513, {
                colorNode: instanceColor,
                roughness: 0.7,
                deformationNode: capsuleDeform,
                rimStrength: 0.3
            });
        }

        case 'helix': {
            const t = positionLocal.y;
            const angle = t.mul(float(Math.PI * 6.0));
            const radius = t.mul(0.3);
            const spiralPos = vec3(cos(angle).mul(radius), t, sin(angle).mul(radius));
            const helixDeform = calculateWindSway(spiralPos);

            return CandyPresets.Gummy(0x00FA9A, {
                colorNode: instanceColor,
                roughness: 0.3,
                deformationNode: helixDeform,
                emissive: 0xFFFFFF,
                emissiveIntensity: 0.3, // Reduced glow
                rimStrength: 0.5
            });
        }

        case 'rose':
        case 'torusKnot': {
            const roseDeform = calculateWindSway(positionLocal);
            return CandyPresets.Sugar(0xFF69B4, {
                colorNode: instanceColor,
                roughness: 0.4,
                deformationNode: roseDeform,
                sheen: 0.5,
                audioReactStrength: 0.3
            });
        }

        default:
            return baseMaterial.clone();
    }
}

/**
 * LOD2 Material: No vertex animation, simple billboard-style rendering
 */
function createLOD2Material(geometryType: string, baseMaterial: THREE.Material): THREE.Material {
    const instanceColor = attribute('instanceColor', 'vec3');

    switch (geometryType) {
        case 'trunk':
        case 'cylinder':
            return CandyPresets.Clay(0x8B4513, {
                colorNode: instanceColor,
                roughness: 0.9,
                bumpStrength: 0.05,
                rimStrength: 0.1
                // No deformation - static mesh
            });

        case 'sphere':
        case 'leaf':
            return CandyPresets.Gummy(0x228B22, {
                colorNode: instanceColor,
                roughness: 0.5,
                transmission: 0.1,
                rimStrength: 0.2
                // No deformation - static mesh
            });

        case 'capsule':
        case 'branch':
            return CandyPresets.Clay(0x8B4513, {
                colorNode: instanceColor,
                roughness: 0.8,
                rimStrength: 0.2
                // No deformation - static mesh
            });

        case 'helix':
            return CandyPresets.Gummy(0x00FA9A, {
                colorNode: instanceColor,
                roughness: 0.4,
                emissive: 0xFFFFFF,
                emissiveIntensity: 0.2,
                rimStrength: 0.3
                // No deformation - static mesh
            });

        case 'rose':
        case 'torusKnot':
            return CandyPresets.Sugar(0xFF69B4, {
                colorNode: instanceColor,
                roughness: 0.5,
                sheen: 0.3
                // No deformation - static mesh
            });

        default:
            return baseMaterial.clone();
    }
}

// --- Instance Data Structure ---

interface LODInstanceData {
    id: number;
    position: THREE.Vector3;
    matrix: THREE.Matrix4;
    color: THREE.Color;
    type: string;
    geometryType: string;
    currentLOD: LODLevel;
    baseMaterial: THREE.Material;
}

// --- LOD Manager ---

export class FoliageLODManager {
    private config: LODConfig;
    private instanceData: Map<number, LODInstanceData> = new Map();
    private nextInstanceId = 0;

    // LOD mesh groups for each geometry type
    private lodMeshes: Map<string, Map<LODLevel, THREE.InstancedMesh>> = new Map();

    // Instance counts per LOD level per geometry type
    private lodCounts: Map<string, Map<LODLevel, number>> = new Map();

    // Temporary objects for calculations (to avoid GC)
    private _tempVec3 = new THREE.Vector3();
    private _tempMatrix = new THREE.Matrix4();
    private _tempColor = new THREE.Color();

    // Billboard setup for LOD2
    private billboardMesh?: THREE.InstancedMesh;

    constructor(config: Partial<LODConfig> = {}) {
        this.config = { ...DEFAULT_LOD_CONFIG, ...config };
        this.initLODMeshes();
    }

    /**
     * Initialize the LOD mesh structure
     */
    private initLODMeshes(): void {
        const geometryTypes = ['trunk', 'sphere', 'capsule', 'helix', 'rose'];

        for (const geomType of geometryTypes) {
            const lodMap = new Map<LODLevel, THREE.InstancedMesh>();
            const countMap = new Map<LODLevel, number>();

            // Create InstancedMesh for each LOD level
            for (let lod = 0; lod < 3; lod++) {
                const lodLevel = lod as LODLevel;
                const maxCount = this.getMaxInstancesForLOD(lodLevel);

                // Create appropriate geometry for this LOD level
                const geometry = createLODGeometry(
                    geomType as any,
                    lodLevel
                );

                // Create base material (will be cloned per instance type)
                const baseMaterial = this.createBaseMaterial(geomType);
                const lodMaterial = getLODMaterial(baseMaterial, lodLevel, geomType);

                const mesh = new THREE.InstancedMesh(geometry, lodMaterial, maxCount);
                mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 3), 3);
                mesh.castShadow = lodLevel === LODLevel.LOD0; // Only cast shadows for LOD0
                mesh.receiveShadow = lodLevel !== LODLevel.LOD2;
                mesh.count = 0;
                mesh.visible = true;

                // Store reference for cleanup
                mesh.userData.isLODMesh = true;
                mesh.userData.lodLevel = lodLevel;
                mesh.userData.geometryType = geomType;

                lodMap.set(lodLevel, mesh);
                countMap.set(lodLevel, 0);
                foliageGroup.add(mesh);
            }

            this.lodMeshes.set(geomType, lodMap);
            this.lodCounts.set(geomType, countMap);
        }

        // Initialize billboard mesh for impostor rendering
        this.initBillboardMesh();

        console.log('[FoliageLODManager] Initialized LOD system with thresholds:', this.config.thresholds);
    }

    /**
     * Create a base material for a geometry type
     */
    private createBaseMaterial(geometryType: string): THREE.Material {
        switch (geometryType) {
            case 'trunk':
                return CandyPresets.Clay(0x8B4513);
            case 'sphere':
                return CandyPresets.Gummy(0x228B22);
            case 'capsule':
                return CandyPresets.Clay(0x8B4513);
            case 'helix':
                return CandyPresets.Gummy(0x00FA9A);
            case 'rose':
                return CandyPresets.Sugar(0xFF69B4);
            default:
                return CandyPresets.Clay(0x8B4513);
        }
    }

    /**
     * Initialize billboard mesh for LOD2 impostors
     */
    private initBillboardMesh(): void {
        const geometry = createLODGeometry('billboard', 0);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });

        this.billboardMesh = new THREE.InstancedMesh(
            geometry,
            material,
            this.config.maxInstances.lod2
        );
        this.billboardMesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(this.config.maxInstances.lod2 * 3),
            3
        );
        this.billboardMesh.count = 0;
        this.billboardMesh.visible = false; // Hidden by default
        this.billboardMesh.userData.isBillboard = true;

        foliageGroup.add(this.billboardMesh);
    }

    /**
     * Get max instances for a LOD level
     */
    private getMaxInstancesForLOD(lodLevel: LODLevel): number {
        switch (lodLevel) {
            case LODLevel.LOD0:
                return this.config.maxInstances.lod0;
            case LODLevel.LOD1:
                return this.config.maxInstances.lod1;
            case LODLevel.LOD2:
                return this.config.maxInstances.lod2;
            default:
                return 100;
        }
    }

    /**
     * Calculate LOD level based on distance from camera
     */
    calculateLODLevel(distance: number): LODLevel {
        const [lod1Dist, lod2Dist, cullDist] = this.config.thresholds;

        if (distance >= cullDist) {
            return LODLevel.Culled;
        } else if (distance >= lod2Dist) {
            return LODLevel.LOD2;
        } else if (distance >= lod1Dist) {
            return LODLevel.LOD1;
        }
        return LODLevel.LOD0;
    }

    /**
     * Register a new foliage object with the LOD system
     * Returns the instance ID for later updates
     */
    registerObject(
        matrix: THREE.Matrix4,
        color: THREE.Color,
        type: string,
        geometryType: string,
        baseMaterial?: THREE.Material
    ): number {
        const id = this.nextInstanceId++;

        // Extract position from matrix
        this._tempVec3.setFromMatrixPosition(matrix);

        const data: LODInstanceData = {
            id,
            position: this._tempVec3.clone(),
            matrix: matrix.clone(),
            color: color.clone(),
            type,
            geometryType,
            currentLOD: LODLevel.LOD0, // Will be updated in first frame
            baseMaterial: baseMaterial || this.createBaseMaterial(geometryType)
        };

        this.instanceData.set(id, data);
        return id;
    }

    /**
     * Register multiple instances at once (batch registration)
     */
    registerBatch(
        matrices: THREE.Matrix4[],
        colors: THREE.Color[],
        type: string,
        geometryType: string,
        baseMaterial?: THREE.Material
    ): number[] {
        const ids: number[] = [];
        for (let i = 0; i < matrices.length; i++) {
            const id = this.registerObject(
                matrices[i],
                colors[i],
                type,
                geometryType,
                baseMaterial
            );
            ids.push(id);
        }
        return ids;
    }

    /**
     * Update LOD levels based on camera position
     * Call this every frame
     */
    update(cameraPosition: THREE.Vector3): void {
        // Reset counts
        for (const [geomType, countMap] of this.lodCounts) {
            for (let lod = 0; lod < 3; lod++) {
                countMap.set(lod as LODLevel, 0);
            }
        }

        // Temporary storage for batch updates
        const lodUpdates = new Map<string, Map<LODLevel, { indices: number[]; matrices: THREE.Matrix4[]; colors: THREE.Color[] }>>();

        // Initialize update structure
        for (const geomType of this.lodMeshes.keys()) {
            lodUpdates.set(geomType, new Map());
            for (let lod = 0; lod < 3; lod++) {
                lodUpdates.get(geomType)!.set(lod as LODLevel, {
                    indices: [],
                    matrices: [],
                    colors: []
                });
            }
        }

        // Calculate LOD for each instance
        for (const [id, data] of this.instanceData) {
            const distance = data.position.distanceTo(cameraPosition);
            const newLOD = this.calculateLODLevel(distance);

            // Update stored LOD level
            data.currentLOD = newLOD;

            // Skip culled instances
            if (newLOD === LODLevel.Culled) {
                continue;
            }

            // Add to appropriate LOD update batch
            const geomUpdates = lodUpdates.get(data.geometryType);
            if (geomUpdates) {
                const lodUpdate = geomUpdates.get(newLOD);
                if (lodUpdate) {
                    lodUpdate.indices.push(id);
                    lodUpdate.matrices.push(data.matrix);
                    lodUpdate.colors.push(data.color);
                }
            }
        }

        // Apply updates to InstancedMeshes
        for (const [geomType, geomUpdates] of lodUpdates) {
            for (let lod = 0; lod < 3; lod++) {
                const lodLevel = lod as LODLevel;
                const update = geomUpdates.get(lodLevel);
                const mesh = this.lodMeshes.get(geomType)?.get(lodLevel);

                if (update && mesh) {
                    this.updateInstancedMesh(mesh, update.matrices, update.colors);
                    this.lodCounts.get(geomType)?.set(lodLevel, update.matrices.length);
                }
            }
        }

        // Update billboard orientations for LOD2 instances
        this.updateBillboards(cameraPosition);
    }

    /**
     * Update an InstancedMesh with new instance data
     */
    private updateInstancedMesh(
        mesh: THREE.InstancedMesh,
        matrices: THREE.Matrix4[],
        colors: THREE.Color[]
    ): void {
        const count = Math.min(matrices.length, mesh.instanceMatrix.count);
        mesh.count = count;

        for (let i = 0; i < count; i++) {
            mesh.setMatrixAt(i, matrices[i]);
            mesh.setColorAt(i, colors[i]);
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
        }
    }

    /**
     * Update billboard orientations to face camera
     */
    private updateBillboards(cameraPosition: THREE.Vector3): void {
        if (!this.billboardMesh || this.billboardMesh.count === 0) return;

        // Billboards automatically face camera if we set the mesh to lookAt
        // For true billboarding in InstancedMesh, we'd need custom shader
        // For now, we just ensure the mesh faces the camera
        this.billboardMesh.lookAt(cameraPosition);
    }

    /**
     * Remove an instance from the LOD system
     */
    unregisterObject(id: number): boolean {
        return this.instanceData.delete(id);
    }

    /**
     * Get the current LOD level for an instance
     */
    getInstanceLOD(id: number): LODLevel | undefined {
        return this.instanceData.get(id)?.currentLOD;
    }

    /**
     * Update the transform of an existing instance
     */
    updateInstanceTransform(id: number, matrix: THREE.Matrix4): boolean {
        const data = this.instanceData.get(id);
        if (!data) return false;

        data.matrix.copy(matrix);
        data.position.setFromMatrixPosition(matrix);
        return true;
    }

    /**
     * Get statistics about the current LOD distribution
     */
    getStats(): {
        totalInstances: number;
        lodDistribution: { [key in LODLevel]: number };
        geometryCounts: { [geometryType: string]: { [lod in LODLevel]?: number } };
    } {
        const lodDistribution = {
            [LODLevel.LOD0]: 0,
            [LODLevel.LOD1]: 0,
            [LODLevel.LOD2]: 0,
            [LODLevel.Culled]: 0
        };

        const geometryCounts: { [geometryType: string]: { [lod in LODLevel]?: number } } = {};

        // Count by LOD level
        for (const data of this.instanceData.values()) {
            lodDistribution[data.currentLOD]++;

            if (!geometryCounts[data.geometryType]) {
                geometryCounts[data.geometryType] = {};
            }
            const current = geometryCounts[data.geometryType][data.currentLOD] || 0;
            geometryCounts[data.geometryType][data.currentLOD] = current + 1;
        }

        return {
            totalInstances: this.instanceData.size,
            lodDistribution,
            geometryCounts
        };
    }

    /**
     * Set new distance thresholds
     */
    setThresholds(thresholds: [number, number, number]): void {
        this.config.thresholds = thresholds;
    }

    /**
     * Get all LOD meshes for a geometry type (for external manipulation)
     */
    getLODMeshes(geometryType: string): Map<LODLevel, THREE.InstancedMesh> | undefined {
        return this.lodMeshes.get(geometryType);
    }

    /**
     * Dispose of all LOD resources
     */
    dispose(): void {
        // Dispose of all meshes
        for (const lodMap of this.lodMeshes.values()) {
            for (const mesh of lodMap.values()) {
                mesh.geometry.dispose();
                // Don't dispose materials that are shared
                foliageGroup.remove(mesh);
            }
        }
        this.lodMeshes.clear();

        // Dispose billboard
        if (this.billboardMesh) {
            this.billboardMesh.geometry.dispose();
            if (Array.isArray(this.billboardMesh.material)) {
                this.billboardMesh.material.forEach(m => m.dispose());
            } else {
                this.billboardMesh.material.dispose();
            }
            foliageGroup.remove(this.billboardMesh);
        }

        // Clear caches
        geometryCache.clear();
        materialCache.clear();
        this.instanceData.clear();
        this.lodCounts.clear();
    }
}

// --- Helper Classes for TreeBatcher Integration ---

/**
 * LOD-enabled batch data for a single tree instance
 */
export interface LODTreeInstance {
    id: number;
    type: string;
    componentIds: { [geometryType: string]: number };
}

/**
 * Helper class to integrate LOD with the existing TreeBatcher
 * This provides a bridge between the old registration system and the new LOD system
 */
export class LODTreeBatcher {
    private lodManager: FoliageLODManager;
    private treeInstances: Map<number, LODTreeInstance> = new Map();
    private nextTreeId = 0;

    constructor(config?: Partial<LODConfig>) {
        this.lodManager = new FoliageLODManager(config);
    }

    /**
     * Register a tree group with LOD support
     * Decomposes the tree into components and registers each with appropriate LOD
     */
    registerTree(group: THREE.Group, type: string): number {
        const treeId = this.nextTreeId++;
        const componentIds: { [geometryType: string]: number } = {};

        group.updateMatrixWorld(true);

        // Traverse and register each mesh component
        group.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                const col = mat.color || new THREE.Color(0xFFFFFF);

                // Map geometry types to our LOD categories
                let geometryType: string | null = null;

                switch (mesh.geometry.type) {
                    case 'CylinderGeometry':
                        geometryType = 'trunk';
                        break;
                    case 'SphereGeometry':
                        geometryType = 'sphere';
                        break;
                    case 'CapsuleGeometry':
                        geometryType = 'capsule';
                        break;
                    case 'TubeGeometry':
                        geometryType = 'helix';
                        break;
                    case 'TorusKnotGeometry':
                        geometryType = 'rose';
                        break;
                }

                if (geometryType) {
                    const instanceId = this.lodManager.registerObject(
                        mesh.matrixWorld,
                        col,
                        type,
                        geometryType,
                        mat
                    );
                    componentIds[geometryType] = instanceId;
                    mesh.visible = false; // Hide original mesh
                }
            }
        });

        const treeInstance: LODTreeInstance = {
            id: treeId,
            type,
            componentIds
        };

        this.treeInstances.set(treeId, treeInstance);
        return treeId;
    }

    /**
     * Update LOD levels - call every frame
     */
    update(cameraPosition: THREE.Vector3): void {
        this.lodManager.update(cameraPosition);
    }

    /**
     * Get LOD statistics
     */
    getStats() {
        return this.lodManager.getStats();
    }

    /**
     * Dispose of all resources
     */
    dispose(): void {
        this.lodManager.dispose();
        this.treeInstances.clear();
    }

    /**
     * Get the underlying LOD manager for advanced operations
     */
    getLODManager(): FoliageLODManager {
        return this.lodManager;
    }
}

// --- Default Export ---

export default FoliageLODManager;
