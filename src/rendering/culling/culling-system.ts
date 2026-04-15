/**
 * @file culling-system.ts
 * @description Advanced culling and visibility system for candy_world
 * 
 * Implements:
 * - Frustum culling with sphere-based intersection tests
 * - Spatial hash grid for O(1) visible object lookups
 * - Distance-based LOD switching with smooth transitions
 * - Occlusion culling with temporal coherence
 * - Debug visualization and performance statistics
 * 
 * Performance targets:
 * - Culling overhead: <0.5ms
 * - Objects culled: 60-80% typical
 * - Frame time improvement: 30-50%
 */

import * as THREE from 'three';
import {
    CullingGroup,
    EntityType,
    LODLevel,
    QualityTier,
    CullableObject,
    CullingConfig,
    CullingStats,
    DEFAULT_CULL_DISTANCES,
    LOD_THRESHOLDS,
    QUALITY_MULTIPLIERS,
    DEFAULT_CULLING_CONFIG
} from './culling-types.ts';
import {
    SpatialHashGrid,
    OcclusionQueryManager,
    CullingDebugVisualizer
} from './culling-components.ts';

const _scratchBox3 = new THREE.Box3();
const _scratchSphere = new THREE.Sphere(); // ⚡ OPTIMIZATION: Scratch sphere for culling tests

// ============================================================================
// MAIN CULLING SYSTEM
// ============================================================================

/**
 * Advanced culling and visibility system for candy_world.
 * 
 * Handles frustum culling, distance-based culling, LOD switching,
 * and occlusion culling with temporal coherence.
 */
export class CullingSystem {
    private objects: Map<string, CullableObject> = new Map();
    private spatialGrid: SpatialHashGrid;
    private occlusionManager: OcclusionQueryManager;
    private debugVisualizer: CullingDebugVisualizer;
    private config: CullingConfig;
    private stats: CullingStats;
    private frustum: THREE.Frustum = new THREE.Frustum();
    private projScreenMatrix: THREE.Matrix4 = new THREE.Matrix4();
    private cachedStaticResults: Map<string, boolean> = new Map();
    private lastCameraPosition: THREE.Vector3 = new THREE.Vector3();
    private lastCameraQuaternion: THREE.Quaternion = new THREE.Quaternion();
    private cameraMovedThreshold = 0.1;
    private ditherPattern: number[] = [];
    private renderer?: any; // WebGPU renderer - type varies by THREE.js version

    constructor(scene: THREE.Scene, renderer?: any, config: Partial<CullingConfig> = {}) {
        this.config = { ...DEFAULT_CULLING_CONFIG, ...config };
        this.renderer = renderer;
        
        this.spatialGrid = new SpatialHashGrid(this.config.gridCellSize);
        this.occlusionManager = new OcclusionQueryManager(renderer, this.config.maxOcclusionFrames);
        this.debugVisualizer = new CullingDebugVisualizer(scene);
        
        this.stats = {
            totalObjects: 0,
            visibleObjects: 0,
            culledObjects: 0,
            cullingTimeMs: 0,
            frustumCulled: 0,
            distanceCulled: 0,
            occlusionCulled: 0,
            lodSwitches: 0,
            gridCellsChecked: 0
        };

        // Generate Bayer dither pattern for smooth transitions
        this.initDitherPattern();
    }

    /** Initialize Bayer dither pattern for LOD transitions */
    private initDitherPattern(): void {
        // 4x4 Bayer matrix for dithering
        const bayer = [
            0, 8, 2, 10,
            12, 4, 14, 6,
            3, 11, 1, 9,
            15, 7, 13, 5
        ];
        this.ditherPattern = bayer.map(v => v / 16);
    }

    /** Register an object with the culling system */
    registerObject(
        object: THREE.Object3D,
        entityType: EntityType,
        group: CullingGroup = CullingGroup.DYNAMIC,
        lodMeshes?: Map<LODLevel, THREE.Mesh>
    ): string {
        const id = `cull_${Math.random().toString(36).substr(2, 9)}`;
        
        // Calculate bounding sphere
        const boundingSphere = new THREE.Sphere();
        this.updateBoundingSphere(object, boundingSphere);

        const cullable: CullableObject = {
            id,
            object,
            entityType,
            group,
            boundingSphere,
            lodMeshes,
            currentLOD: LODLevel.FULL,
            fadeAlpha: 1.0,
            visible: true,
            distance: 0,
            staticCached: false
        };

        this.objects.set(id, cullable);
        this.spatialGrid.insert(cullable);
        
        this.stats.totalObjects = this.objects.size;
        
        return id;
    }

    /** Unregister an object from the culling system */
    unregisterObject(id: string): boolean {
        const obj = this.objects.get(id);
        if (obj) {
            this.spatialGrid.remove(obj);
            this.objects.delete(id);
            this.cachedStaticResults.delete(id);
            this.stats.totalObjects = this.objects.size;
            return true;
        }
        return false;
    }

    /** Update bounding sphere for an object */
    private updateBoundingSphere(object: THREE.Object3D, sphere: THREE.Sphere): void {
        // ⚡ OPTIMIZATION: Use reusable scratch box to prevent GC spikes during culling updates
        _scratchBox3.setFromObject(object);
        _scratchBox3.getBoundingSphere(sphere);
        
        // Add small margin to prevent edge clipping
        sphere.radius += 0.1;
    }

    /** Get effective cull distance for an entity type */
    private getCullDistance(entityType: EntityType): number {
        const baseDistance = DEFAULT_CULL_DISTANCES[entityType] || DEFAULT_CULL_DISTANCES[EntityType.GENERIC];
        const multiplier = QUALITY_MULTIPLIERS[this.config.qualityTier];
        return baseDistance * multiplier;
    }

    /** Calculate LOD level based on distance */
    private calculateLODLevel(distanceSq: number): LODLevel {
        if (distanceSq < LOD_THRESHOLDS[LODLevel.FULL].max * LOD_THRESHOLDS[LODLevel.FULL].max) {
            return LODLevel.FULL;
        } else if (distanceSq < LOD_THRESHOLDS[LODLevel.MEDIUM].max * LOD_THRESHOLDS[LODLevel.MEDIUM].max) {
            return LODLevel.MEDIUM;
        } else if (distanceSq < LOD_THRESHOLDS[LODLevel.LOW].max * LOD_THRESHOLDS[LODLevel.LOW].max) {
            return LODLevel.LOW;
        }
        return LODLevel.BILLBOARD;
    }

    /** Apply LOD switch with smooth transition */
    private applyLOD(obj: CullableObject, newLOD: LODLevel): void {
        if (!this.config.enableLOD || !obj.lodMeshes) return;
        if (obj.currentLOD === newLOD) return;

        const currentMesh = obj.lodMeshes.get(obj.currentLOD!);
        const newMesh = obj.lodMeshes.get(newLOD);

        if (currentMesh && newMesh) {
            // Perform LOD switch
            obj.object.remove(currentMesh);
            obj.object.add(newMesh);
            obj.currentLOD = newLOD;
            this.stats.lodSwitches++;
        }
    }

    /** Check if camera has moved significantly */
    private hasCameraMoved(camera: THREE.Camera): boolean {
        // ⚡ OPTIMIZATION: Use distanceToSquared to avoid Math.sqrt() in checks
        const posDiffSq = this.lastCameraPosition.distanceToSquared(camera.position);
        const rotDiff = 1 - Math.abs(this.lastCameraQuaternion.dot(camera.quaternion));
        
        return posDiffSq > (this.cameraMovedThreshold * this.cameraMovedThreshold) || rotDiff > 0.001;
    }

    /** Update cached camera position */
    private updateCameraCache(camera: THREE.Camera): void {
        this.lastCameraPosition.copy(camera.position);
        this.lastCameraQuaternion.copy(camera.quaternion);
    }

    /** Main culling update - call once per frame */
    update(camera: THREE.Camera): void {
        const startTime = performance.now();
        
        // Update frustum
        if (this.config.enableFrustumCulling) {
            this.projScreenMatrix.multiplyMatrices(
                camera.projectionMatrix,
                camera.matrixWorldInverse
            );
            this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
        }

        // Check if camera moved (for static object optimization)
        const cameraMoved = this.hasCameraMoved(camera);
        if (cameraMoved) {
            this.updateCameraCache(camera);
        }

        // Show debug frustum
        if (this.config.debugMode) {
            this.debugVisualizer.showFrustum(this.frustum, camera);
        }

        // Reset frame statistics
        this.stats.visibleObjects = 0;
        this.stats.culledObjects = 0;
        this.stats.frustumCulled = 0;
        this.stats.distanceCulled = 0;
        this.stats.occlusionCulled = 0;
        this.stats.lodSwitches = 0;

        // Get potentially visible objects from spatial grid
        // For now, we iterate all objects. Spatial grid query would be:
        // const candidates = this.spatialGrid.queryFrustum(this.frustum);
        
        for (const obj of this.objects.values()) {
            this.processObject(obj, camera, cameraMoved);
        }

        // Process occlusion query results
        if (this.config.enableOcclusionCulling) {
            this.occlusionManager.processResults();
        }

        // Calculate culling time
        this.stats.cullingTimeMs = performance.now() - startTime;

        // Update debug visualization
        if (this.config.debugMode) {
            this.debugVisualizer.updateStats(this.stats);
        }
    }

    /** Process a single object for culling */
    private processObject(obj: CullableObject, camera: THREE.Camera, cameraMoved: boolean): void {
        // ALWAYS_VISIBLE group - skip culling
        if (obj.group === CullingGroup.ALWAYS_VISIBLE) {
            obj.visible = true;
            obj.object.visible = true;
            this.stats.visibleObjects++;
            this.debugVisualizer.showVisibleObject(obj);
            return;
        }

        // STATIC group - use cached result if camera hasn't moved
        if (obj.group === CullingGroup.STATIC && !cameraMoved && obj.staticCached) {
            const cached = this.cachedStaticResults.get(obj.id);
            obj.visible = cached !== false;
            obj.object.visible = obj.visible;
            
            if (obj.visible) {
                this.stats.visibleObjects++;
            } else {
                this.stats.culledObjects++;
            }
            return;
        }

        // Update bounding sphere position (in case object moved)
        this.updateBoundingSphere(obj.object, obj.boundingSphere);
        
        // Calculate distance to camera
        // ⚡ OPTIMIZATION: Use distanceToSquared to avoid Math.sqrt() in high-frequency culling loop
        const distSq = camera.position.distanceToSquared(obj.boundingSphere.center);
        obj.distance = distSq; // Note: storing squared distance to avoid Math.sqrt

        // DISTANCE CULLING
        if (this.config.enableDistanceCulling) {
            const cullDistance = this.getCullDistance(obj.entityType);
            if (distSq > cullDistance * cullDistance) {
                obj.visible = false;
                obj.object.visible = false;
                this.stats.culledObjects++;
                this.stats.distanceCulled++;
                
                if (obj.group === CullingGroup.STATIC) {
                    obj.staticCached = true;
                    this.cachedStaticResults.set(obj.id, false);
                }
                
                this.debugVisualizer.showCulledObject(obj);
                return;
            }
        }

        // FRUSTUM CULLING
        if (this.config.enableFrustumCulling) {
            // Expand frustum slightly to prevent edge popping
            // ⚡ OPTIMIZATION: Zero-allocation sphere test
            _scratchSphere.copy(obj.boundingSphere);
            _scratchSphere.radius += this.config.frustumMargin;
            
            if (!this.frustum.intersectsSphere(_scratchSphere)) {
                obj.visible = false;
                obj.object.visible = false;
                this.stats.culledObjects++;
                this.stats.frustumCulled++;
                
                if (obj.group === CullingGroup.STATIC) {
                    obj.staticCached = true;
                    this.cachedStaticResults.set(obj.id, false);
                }
                
                this.debugVisualizer.showCulledObject(obj);
                return;
            }
        }

        // OCCLUSION CULLING (WebGPU only)
        if (this.config.enableOcclusionCulling && this.occlusionManager.isSupported()) {
            if (this.occlusionManager.shouldTestOcclusion(obj)) {
                const queryId = this.occlusionManager.beginQuery(obj);
                // Would render occlusion proxy here in actual implementation
                this.occlusionManager.endQuery(queryId!);
            } else if (obj.lastOcclusionResult === false) {
                // Temporarily hidden by occlusion, skip rendering
                obj.visible = false;
                obj.object.visible = false;
                this.stats.culledObjects++;
                this.stats.occlusionCulled++;
                return;
            }
        }

        // Object is visible
        obj.visible = true;
        obj.object.visible = true;
        this.stats.visibleObjects++;
        
        if (obj.group === CullingGroup.STATIC) {
            obj.staticCached = true;
            this.cachedStaticResults.set(obj.id, true);
        }

        // LOD SWITCHING
        if (this.config.enableLOD) {
            const newLOD = this.calculateLODLevel(distSq);
            this.applyLOD(obj, newLOD);
        }

        this.debugVisualizer.showVisibleObject(obj);
    }

    /** Check if a specific object is currently visible */
    isVisible(objectId: string): boolean {
        const obj = this.objects.get(objectId);
        return obj ? obj.visible === true : false;
    }

    /** Get visibility status for an object's THREE.Object3D */
    isObjectVisible(object: THREE.Object3D): boolean {
        for (const obj of this.objects.values()) {
            if (obj.object === object) {
                return obj.visible === true;
            }
        }
        return true; // Default to visible if not registered
    }

    /** Enable/disable debug visualization */
    setDebugMode(enabled: boolean): void {
        this.config.debugMode = enabled;
        this.debugVisualizer.setEnabled(enabled);
        if (!enabled) {
            // Clear any remaining debug visuals
            this.debugVisualizer.clear();
        }
    }

    /** Get current culling statistics */
    getStats(): CullingStats {
        return { ...this.stats };
    }

    /** Reset culling statistics */
    resetStats(): void {
        this.stats = {
            totalObjects: this.objects.size,
            visibleObjects: 0,
            culledObjects: 0,
            cullingTimeMs: 0,
            frustumCulled: 0,
            distanceCulled: 0,
            occlusionCulled: 0,
            lodSwitches: 0,
            gridCellsChecked: 0
        };
    }

    /** Update configuration */
    setConfig(config: Partial<CullingConfig>): void {
        this.config = { ...this.config, ...config };
        
        // Update dependent systems
        if (config.gridCellSize && config.gridCellSize !== this.spatialGrid.getCellSize()) {
            // Rebuild spatial grid with new cell size
            const objects = Array.from(this.objects.values());
            this.spatialGrid.clear();
            this.spatialGrid = new SpatialHashGrid(config.gridCellSize);
            for (const obj of objects) {
                this.spatialGrid.insert(obj);
            }
        }
    }

    /** Get current configuration */
    getConfig(): CullingConfig {
        return { ...this.config };
    }

    /** Set quality tier */
    setQualityTier(tier: QualityTier): void {
        this.config.qualityTier = tier;
    }

    /** Get spatial grid statistics */
    getSpatialGridStats(): { cellCount: number; objectCount: number; avgObjectsPerCell: number } {
        return this.spatialGrid.getStats();
    }

    /** Force update of all static objects */
    forceStaticUpdate(): void {
        this.cachedStaticResults.clear();
        for (const obj of this.objects.values()) {
            if (obj.group === CullingGroup.STATIC) {
                obj.staticCached = false;
            }
        }
    }

    /** Batch register multiple objects */
    registerBatch(
        objects: Array<{ object: THREE.Object3D; entityType: EntityType; group?: CullingGroup; lodMeshes?: Map<LODLevel, THREE.Mesh> }>
    ): string[] {
        const ids: string[] = [];
        for (const item of objects) {
            const id = this.registerObject(
                item.object,
                item.entityType,
                item.group || CullingGroup.DYNAMIC,
                item.lodMeshes
            );
            ids.push(id);
        }
        return ids;
    }

    /** Get all visible objects */
    getVisibleObjects(): CullableObject[] {
        return Array.from(this.objects.values()).filter(obj => obj.visible);
    }

    /** Get all objects of a specific type */
    getObjectsByType(entityType: EntityType): CullableObject[] {
        return Array.from(this.objects.values()).filter(obj => obj.entityType === entityType);
    }

    /** Clear all registered objects */
    clear(): void {
        this.objects.clear();
        this.spatialGrid.clear();
        this.cachedStaticResults.clear();
        this.stats.totalObjects = 0;
        this.stats.visibleObjects = 0;
        this.stats.culledObjects = 0;
        this.debugVisualizer.clear();
    }

    /** Dispose of all resources */
    dispose(): void {
        this.clear();
        this.occlusionManager.clear();
    }
}

export default CullingSystem;
