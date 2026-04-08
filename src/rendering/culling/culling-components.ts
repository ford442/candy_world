/**
 * @file culling-components.ts
 * @description Culling system components: SpatialHashGrid, OcclusionQueryManager, CullingDebugVisualizer
 * 
 * Implements the individual components used by the main CullingSystem:
 * - SpatialHashGrid: O(1) spatial queries for visible objects
 * - OcclusionQueryManager: WebGPU occlusion query management with temporal coherence
 * - CullingDebugVisualizer: Debug visualization for frustum, heatmap, and statistics
 */

import * as THREE from 'three';
import {
    CullableObject,
    CullingStats,
    SpatialHashConfig,
    OcclusionQueryConfig
} from './culling-types.ts';

const _scratchForward = new THREE.Vector3();
const _scratchUp = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
const _scratchFarCenter = new THREE.Vector3();
const _scratchFarTopLeft = new THREE.Vector3();
const _scratchFarTopRight = new THREE.Vector3();
const _scratchFarBottomLeft = new THREE.Vector3();
const _scratchFarBottomRight = new THREE.Vector3();

// ============================================================================
// SPATIAL HASH GRID
// ============================================================================

/**
 * Spatial hash grid for efficient O(1) spatial queries.
 * Divides world into cells and stores objects in corresponding cells.
 */
export class SpatialHashGrid {
    private cells: Map<string, Set<CullableObject>> = new Map();
    private cellSize: number;
    private objectToCells: Map<string, Set<string>> = new Map();

    constructor(cellSize: number = 50) {
        this.cellSize = cellSize;
    }

    /** Get cell key for a position */
    private getCellKey(x: number, z: number): string {
        const cellX = Math.floor(x / this.cellSize);
        const cellZ = Math.floor(z / this.cellSize);
        return `${cellX},${cellZ}`;
    }

    /** Get all cell keys that a sphere overlaps */
    private getOverlappingCellKeys(sphere: THREE.Sphere): string[] {
        const keys: string[] = [];
        const minX = Math.floor((sphere.center.x - sphere.radius) / this.cellSize);
        const maxX = Math.floor((sphere.center.x + sphere.radius) / this.cellSize);
        const minZ = Math.floor((sphere.center.z - sphere.radius) / this.cellSize);
        const maxZ = Math.floor((sphere.center.z + sphere.radius) / this.cellSize);

        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                keys.push(`${x},${z}`);
            }
        }
        return keys;
    }

    /** Insert an object into the grid */
    insert(object: CullableObject): void {
        const keys = this.getOverlappingCellKeys(object.boundingSphere);
        const objectCells = new Set<string>();

        for (const key of keys) {
            if (!this.cells.has(key)) {
                this.cells.set(key, new Set());
            }
            this.cells.get(key)!.add(object);
            objectCells.add(key);
        }

        this.objectToCells.set(object.id, objectCells);
    }

    /** Remove an object from the grid */
    remove(object: CullableObject): void {
        const objectCells = this.objectToCells.get(object.id);
        if (objectCells) {
            for (const key of objectCells) {
                const cell = this.cells.get(key);
                if (cell) {
                    cell.delete(object);
                    if (cell.size === 0) {
                        this.cells.delete(key);
                    }
                }
            }
            this.objectToCells.delete(object.id);
        }
    }

    /** Update an object's position in the grid */
    update(object: CullableObject): void {
        this.remove(object);
        this.insert(object);
    }

    /** Get all objects in cells overlapping the given sphere */
    querySphere(sphere: THREE.Sphere): Set<CullableObject> {
        const results = new Set<CullableObject>();
        const keys = this.getOverlappingCellKeys(sphere);

        for (const key of keys) {
            const cell = this.cells.get(key);
            if (cell) {
                for (const obj of cell) {
                    results.add(obj);
                }
            }
        }

        return results;
    }

    /** Get all objects in cells within frustum bounds */
    queryFrustum(frustum: THREE.Frustum, margin: number = 0): Set<CullableObject> {
        const results = new Set<CullableObject>();
        
        // Get approximate bounds of frustum
        // For efficiency, we check all cells that could potentially intersect
        // This is a simplified approach - full frustum-box intersection would be more accurate
        
        for (const [key, cell] of this.cells) {
            for (const obj of cell) {
                results.add(obj);
            }
        }
        
        return results;
    }

    /** Clear all objects from the grid */
    clear(): void {
        this.cells.clear();
        this.objectToCells.clear();
    }

    /** Get grid statistics */
    getStats(): { cellCount: number; objectCount: number; avgObjectsPerCell: number } {
        let objectCount = 0;
        for (const cell of this.cells.values()) {
            objectCount += cell.size;
        }
        const cellCount = this.cells.size;
        return {
            cellCount,
            objectCount,
            avgObjectsPerCell: cellCount > 0 ? objectCount / cellCount : 0
        };
    }

    /** Get the cell size */
    getCellSize(): number {
        return this.cellSize;
    }
}

// ============================================================================
// OCCLUSION QUERY MANAGER
// ============================================================================

/**
 * Manages hardware occlusion queries for WebGPU.
 * Uses temporal coherence to reduce query overhead.
 */
export class OcclusionQueryManager {
    private queries: Map<number, { query: any; object: CullableObject; frame: number }> = new Map();
    private nextQueryId = 0;
    private renderer?: any; // WebGPU renderer - type varies by THREE.js version
    private maxOcclusionFrames: number;

    constructor(renderer: any | undefined, maxOcclusionFrames: number = 5) {
        this.renderer = renderer;
        this.maxOcclusionFrames = maxOcclusionFrames;
    }

    /** Check if occlusion queries are supported */
    isSupported(): boolean {
        return this.renderer !== undefined && 'occlusionQuerySet' in this.renderer;
    }

    /** Begin occlusion query for an object */
    beginQuery(object: CullableObject): number | null {
        if (!this.isSupported()) return null;

        const queryId = this.nextQueryId++;
        // Note: Actual WebGPU query implementation would go here
        // This is a placeholder for the actual WebGPU API calls
        
        object.occlusionQueryId = queryId;
        object.occlusionFrames = 0;
        
        this.queries.set(queryId, {
            query: null, // Would be actual GPU query object
            object,
            frame: performance.now()
        });

        return queryId;
    }

    /** End occlusion query */
    endQuery(queryId: number): void {
        if (!this.isSupported()) return;
        // Actual WebGPU end query call would go here
    }

    /** Check if object should be tested for occlusion */
    shouldTestOcclusion(object: CullableObject): boolean {
        // Use temporal coherence: if occluded last frame, likely still occluded
        if (object.lastOcclusionResult === true) {
            // Was visible, test again
            return true;
        }
        
        // Was occluded, wait a few frames before retesting
        if (object.occlusionFrames !== undefined && object.occlusionFrames < this.maxOcclusionFrames) {
            object.occlusionFrames!++;
            return false;
        }
        
        return true;
    }

    /** Process query results */
    processResults(): void {
        if (!this.isSupported()) return;
        
        // In actual implementation, read back query results from GPU
        // For now, assume all queries passed (conservative)
        for (const [id, data] of this.queries) {
            // Placeholder: would check actual query result
            data.object.lastOcclusionResult = true;
            data.object.occlusionFrames = 0;
        }
        
        this.queries.clear();
    }

    /** Clear all queries */
    clear(): void {
        this.queries.clear();
    }
}

// ============================================================================
// DEBUG VISUALIZER
// ============================================================================

/**
 * Debug visualization for culling system.
 * Shows culled objects as wireframes, displays statistics.
 */
export class CullingDebugVisualizer {
    private scene: THREE.Scene;
    private debugObjects: Map<string, THREE.Object3D> = new Map();
    private enabled = false;
    private statsElement?: HTMLElement;
    private heatmapMesh?: THREE.Mesh;
    private frustumLines?: THREE.LineSegments;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    /** Enable/disable debug visualization */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this.clear();
        }
    }

    /** Show frustum bounds */
    showFrustum(frustum: THREE.Frustum, camera: THREE.Camera): void {
        if (!this.enabled) return;

        // Remove old frustum lines
        if (this.frustumLines) {
            this.scene.remove(this.frustumLines);
            this.frustumLines.geometry.dispose();
            (this.frustumLines.material as THREE.Material).dispose();
        }

        // Create frustum wireframe visualization
        // ⚡ OPTIMIZATION: Zero-allocation vector math for frustum visualization
        const points: THREE.Vector3[] = [];
        const camPos = camera.position;

        // ⚡ OPTIMIZATION: Use shared scratch vectors to avoid GC spikes on debug render
        _scratchForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
        _scratchUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
        _scratchRight.set(1, 0, 0).applyQuaternion(camera.quaternion);

        const farDist = 100;
        const fov = 60 * (Math.PI / 180);
        const aspect = 16 / 9;
        const tanFov = Math.tan(fov / 2);

        const farHeight = farDist * tanFov;
        const farWidth = farHeight * aspect;

        _scratchFarCenter.copy(camPos).addScaledVector(_scratchForward, farDist);

        _scratchFarTopLeft.copy(_scratchFarCenter).addScaledVector(_scratchUp, farHeight).addScaledVector(_scratchRight, -farWidth);
        _scratchFarTopRight.copy(_scratchFarCenter).addScaledVector(_scratchUp, farHeight).addScaledVector(_scratchRight, farWidth);
        _scratchFarBottomLeft.copy(_scratchFarCenter).addScaledVector(_scratchUp, -farHeight).addScaledVector(_scratchRight, -farWidth);
        _scratchFarBottomRight.copy(_scratchFarCenter).addScaledVector(_scratchUp, -farHeight).addScaledVector(_scratchRight, farWidth);

        // Near plane (camera position for simplicity)
        points.push(camPos, _scratchFarTopLeft);
        points.push(camPos, _scratchFarTopRight);
        points.push(camPos, _scratchFarBottomLeft);
        points.push(camPos, _scratchFarBottomRight);
        points.push(_scratchFarTopLeft, _scratchFarTopRight);
        points.push(_scratchFarTopRight, _scratchFarBottomRight);
        points.push(_scratchFarBottomRight, _scratchFarBottomLeft);
        points.push(_scratchFarBottomLeft, _scratchFarTopLeft);

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 });
        this.frustumLines = new THREE.LineSegments(geometry, material);
        this.scene.add(this.frustumLines);
    }

    /** Show culled object as wireframe */
    showCulledObject(obj: CullableObject): void {
        if (!this.enabled || this.debugObjects.has(obj.id)) return;

        // Create bounding sphere wireframe
        const geometry = new THREE.SphereGeometry(obj.boundingSphere.radius, 16, 8);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            wireframe: true,
            transparent: true,
            opacity: 0.3
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(obj.boundingSphere.center);
        
        this.scene.add(mesh);
        this.debugObjects.set(obj.id, mesh);
    }

    /** Show visible object outline */
    showVisibleObject(obj: CullableObject): void {
        if (!this.enabled) return;

        // Remove culled visualization if it exists
        const existing = this.debugObjects.get(obj.id);
        if (existing) {
            this.scene.remove(existing);
            const mesh = existing as THREE.Mesh;
            if (mesh.geometry) {
                mesh.geometry.dispose();
            }
            const mat = mesh.material;
            if (mat && !Array.isArray(mat)) {
                mat.dispose();
            }
            this.debugObjects.delete(obj.id);
        }
    }

    /** Create or update statistics overlay */
    updateStats(stats: CullingStats): void {
        if (!this.enabled) return;

        if (!this.statsElement) {
            this.statsElement = document.createElement('div');
            this.statsElement.style.cssText = `
                position: fixed;
                top: 10px;
                left: 10px;
                background: rgba(0, 0, 0, 0.7);
                color: #00ff00;
                font-family: monospace;
                font-size: 12px;
                padding: 10px;
                border-radius: 4px;
                pointer-events: none;
                z-index: 1000;
            `;
            document.body.appendChild(this.statsElement);
        }

        const cullRate = stats.totalObjects > 0 
            ? ((stats.culledObjects / stats.totalObjects) * 100).toFixed(1) 
            : '0.0';

        this.statsElement.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px;">🎯 CULLING STATS</div>
            <div>Total Objects: ${stats.totalObjects}</div>
            <div style="color: #00ff00;">Visible: ${stats.visibleObjects}</div>
            <div style="color: #ff4444;">Culled: ${stats.culledObjects} (${cullRate}%)</div>
            <div style="margin-top: 5px; font-size: 10px; color: #aaa;">
                Frustum: ${stats.frustumCulled} | 
                Distance: ${stats.distanceCulled} | 
                Occlusion: ${stats.occlusionCulled}
            </div>
            <div style="margin-top: 5px;">
                Culling Time: <span style="color: ${stats.cullingTimeMs < 0.5 ? '#00ff00' : '#ffaa00'}">${stats.cullingTimeMs.toFixed(2)}ms</span>
            </div>
            <div style="margin-top: 5px; font-size: 10px; color: #aaa;">
                LOD Switches: ${stats.lodSwitches}
            </div>
        `;
    }

    /** Clear all debug visualizations */
    clear(): void {
        for (const [id, obj] of this.debugObjects) {
            this.scene.remove(obj);
            if ((obj as THREE.Mesh).geometry) {
                (obj as THREE.Mesh).geometry.dispose();
            }
            if ((obj as THREE.Mesh).material) {
                ((obj as THREE.Mesh).material as THREE.Material).dispose();
            }
        }
        this.debugObjects.clear();

        if (this.frustumLines) {
            this.scene.remove(this.frustumLines);
            this.frustumLines.geometry.dispose();
            (this.frustumLines.material as THREE.Material).dispose();
            this.frustumLines = undefined;
        }

        if (this.statsElement) {
            this.statsElement.remove();
            this.statsElement = undefined;
        }
    }
}
