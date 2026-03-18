// src/utils/geometry-dedup.ts
// Geometry deduplication system to reduce buffer allocations
// Uses hash-based lookup with reference counting for automatic cleanup

import * as THREE from 'three';

/**
 * Geometry creation parameters for hashing
 */
export interface GeometryParams {
    type: string;
    args: any[];
    translate?: [number, number, number];
    rotate?: [number, number, number];
    scale?: [number, number, number];
}

/**
 * Statistics for geometry deduplication
 */
export interface GeometryStats {
    /** Number of cache hits (reuse) */
    hits: number;
    /** Number of cache misses (new creation) */
    misses: number;
    /** Total geometries requested */
    totalRequests: number;
    /** Unique geometries stored */
    uniqueGeometries: number;
    /** Memory saved in bytes (estimated) */
    memorySaved: number;
}

/**
 * Registry entry with reference counting
 */
interface RegistryEntry {
    geometry: THREE.BufferGeometry;
    params: GeometryParams;
    refCount: number;
    createdAt: number;
}

/**
 * Global geometry registry for deduplication
 * Prevents duplicate geometry creation across the application
 */
export class GeometryRegistry {
    private static instance: GeometryRegistry;
    private registry: Map<string, RegistryEntry> = new Map();
    private stats: GeometryStats = {
        hits: 0,
        misses: 0,
        totalRequests: 0,
        memorySaved: 0
    };

    // Estimated bytes per vertex (position + normal + uv)
    private readonly BYTES_PER_VERTEX = (3 + 3 + 2) * 4; // 32 bytes

    static getInstance(): GeometryRegistry {
        if (!GeometryRegistry.instance) {
            GeometryRegistry.instance = new GeometryRegistry();
        }
        return GeometryRegistry.instance;
    }

    /**
     * Generate a hash key from geometry parameters
     */
    private generateKey(params: GeometryParams): string {
        const argsHash = JSON.stringify(params.args);
        const transformHash = `${params.translate?.join(',') || ''}|${params.rotate?.join(',') || ''}|${params.scale?.join(',') || ''}`;
        return `${params.type}:${argsHash}:${transformHash}`;
    }

    /**
     * Estimate memory usage of a geometry
     */
    private estimateMemory(geometry: THREE.BufferGeometry): number {
        let totalBytes = 0;
        
        // Count vertices from position attribute
        const positionAttr = geometry.attributes.position;
        if (positionAttr) {
            totalBytes += positionAttr.count * this.BYTES_PER_VERTEX;
        }
        
        // Count index buffer if present
        if (geometry.index) {
            totalBytes += geometry.index.count * 4; // 32-bit indices
        }
        
        return totalBytes;
    }

    /**
     * Get or create a geometry based on parameters
     * Returns a shared geometry instance with reference counting
     */
    getOrCreate(params: GeometryParams): THREE.BufferGeometry {
        this.stats.totalRequests++;
        const key = this.generateKey(params);
        
        const existing = this.registry.get(key);
        if (existing) {
            existing.refCount++;
            this.stats.hits++;
            return existing.geometry;
        }

        // Create new geometry
        const geometry = this.createGeometry(params);
        
        this.registry.set(key, {
            geometry,
            params,
            refCount: 1,
            createdAt: Date.now()
        });

        this.stats.misses++;
        this.stats.uniqueGeometries = this.registry.size;
        
        return geometry;
    }

    /**
     * Create a new Three.js geometry from parameters
     */
    private createGeometry(params: GeometryParams): THREE.BufferGeometry {
        let geometry: THREE.BufferGeometry;

        switch (params.type) {
            case 'SphereGeometry':
                geometry = new THREE.SphereGeometry(...params.args as [number, number, number, number?, number?, number?, number?]);
                break;
            case 'BoxGeometry':
                geometry = new THREE.BoxGeometry(...params.args as [number, number, number, number?, number?, number?]);
                break;
            case 'CylinderGeometry':
                geometry = new THREE.CylinderGeometry(...params.args as [number, number, number, number?, number?, boolean?, number?, number?]);
                break;
            case 'ConeGeometry':
                geometry = new THREE.ConeGeometry(...params.args as [number, number, number, number?, boolean?, number?, number?]);
                break;
            case 'CapsuleGeometry':
                geometry = new THREE.CapsuleGeometry(...params.args as [number, number, number, number?]);
                break;
            case 'PlaneGeometry':
                geometry = new THREE.PlaneGeometry(...params.args as [number, number, number?, number?]);
                break;
            case 'CircleGeometry':
                geometry = new THREE.CircleGeometry(...params.args as [number, number, number?, number?]);
                break;
            case 'TorusGeometry':
                geometry = new THREE.TorusGeometry(...params.args as [number, number, number, number, number?]);
                break;
            case 'TorusKnotGeometry':
                geometry = new THREE.TorusKnotGeometry(...params.args as [number, number, number, number, number, number]);
                break;
            case 'IcosahedronGeometry':
                geometry = new THREE.IcosahedronGeometry(...params.args as [number, number?]);
                break;
            case 'DodecahedronGeometry':
                geometry = new THREE.DodecahedronGeometry(...params.args as [number, number?]);
                break;
            case 'OctahedronGeometry':
                geometry = new THREE.OctahedronGeometry(...params.args as [number, number?]);
                break;
            default:
                throw new Error(`Unsupported geometry type: ${params.type}`);
        }

        // Apply transformations
        if (params.translate) {
            geometry.translate(...params.translate);
        }
        if (params.rotate) {
            geometry.rotateX(params.rotate[0]);
            geometry.rotateY(params.rotate[1]);
            geometry.rotateZ(params.rotate[2]);
        }
        if (params.scale) {
            geometry.scale(...params.scale);
        }

        return geometry;
    }

    /**
     * Release a reference to a geometry
     * When refCount reaches 0, the geometry can be disposed
     */
    release(geometry: THREE.BufferGeometry): void {
        for (const [key, entry] of this.registry) {
            if (entry.geometry === geometry) {
                entry.refCount--;
                if (entry.refCount <= 0) {
                    geometry.dispose();
                    this.registry.delete(key);
                    this.stats.uniqueGeometries = this.registry.size;
                }
                return;
            }
        }
    }

    /**
     * Force dispose all geometries (use with caution)
     */
    disposeAll(): void {
        for (const [, entry] of this.registry) {
            entry.geometry.dispose();
        }
        this.registry.clear();
        this.stats.uniqueGeometries = 0;
    }

    /**
     * Get current statistics
     */
    getStats(): GeometryStats {
        // Calculate memory saved
        let totalMemory = 0;
        for (const [, entry] of this.registry) {
            totalMemory += this.estimateMemory(entry.geometry) * entry.refCount;
        }
        // Memory saved = (total refs - unique) * avg memory per geometry
        const uniqueMemory = Array.from(this.registry.values()).reduce((sum, e) => 
            sum + this.estimateMemory(e.geometry), 0);
        this.stats.memorySaved = Math.max(0, totalMemory - uniqueMemory);
        
        return { ...this.stats };
    }

    /**
     * Reset statistics counters
     */
    resetStats(): void {
        this.stats = {
            hits: 0,
            misses: 0,
            totalRequests: 0,
            uniqueGeometries: this.registry.size,
            memorySaved: 0
        };
    }

    /**
     * Get all registered geometries for debugging
     */
    getAllEntries(): Array<{ key: string; refCount: number; type: string }> {
        return Array.from(this.registry.entries()).map(([key, entry]) => ({
            key,
            refCount: entry.refCount,
            type: entry.params.type
        }));
    }

    /**
     * Get the number of unique geometries
     */
    getUniqueCount(): number {
        return this.registry.size;
    }

    /**
     * Get total reference count across all geometries
     */
    getTotalRefCount(): number {
        return Array.from(this.registry.values()).reduce((sum, e) => sum + e.refCount, 0);
    }
}

// Global singleton instance
export const geometryRegistry = GeometryRegistry.getInstance();

/**
 * Convenience functions for common geometry types
 * These provide a cleaner API for creating shared geometries
 */

export function getSphereGeometry(
    radius: number = 1,
    widthSegments: number = 32,
    heightSegments: number = 16,
    phiStart?: number,
    phiLength?: number,
    thetaStart?: number,
    thetaLength?: number
): THREE.BufferGeometry {
    return geometryRegistry.getOrCreate({
        type: 'SphereGeometry',
        args: [radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength]
    });
}

export function getBoxGeometry(
    width: number = 1,
    height: number = 1,
    depth: number = 1,
    widthSegments?: number,
    heightSegments?: number,
    depthSegments?: number
): THREE.BufferGeometry {
    return geometryRegistry.getOrCreate({
        type: 'BoxGeometry',
        args: [width, height, depth, widthSegments, heightSegments, depthSegments]
    });
}

export function getCylinderGeometry(
    radiusTop: number = 1,
    radiusBottom: number = 1,
    height: number = 1,
    radialSegments: number = 32,
    heightSegments?: number,
    openEnded?: boolean,
    thetaStart?: number,
    thetaLength?: number
): THREE.BufferGeometry {
    return geometryRegistry.getOrCreate({
        type: 'CylinderGeometry',
        args: [radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength]
    });
}

export function getConeGeometry(
    radius: number = 1,
    height: number = 1,
    radialSegments: number = 32,
    heightSegments?: number,
    openEnded?: boolean,
    thetaStart?: number,
    thetaLength?: number
): THREE.BufferGeometry {
    return geometryRegistry.getOrCreate({
        type: 'ConeGeometry',
        args: [radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength]
    });
}

export function getCapsuleGeometry(
    radius: number = 1,
    length: number = 1,
    capSegments?: number,
    radialSegments?: number
): THREE.BufferGeometry {
    return geometryRegistry.getOrCreate({
        type: 'CapsuleGeometry',
        args: [radius, length, capSegments, radialSegments]
    });
}

export function getPlaneGeometry(
    width: number = 1,
    height: number = 1,
    widthSegments?: number,
    heightSegments?: number
): THREE.BufferGeometry {
    return geometryRegistry.getOrCreate({
        type: 'PlaneGeometry',
        args: [width, height, widthSegments, heightSegments]
    });
}

export function getCircleGeometry(
    radius: number = 1,
    segments: number = 32,
    thetaStart?: number,
    thetaLength?: number
): THREE.BufferGeometry {
    return geometryRegistry.getOrCreate({
        type: 'CircleGeometry',
        args: [radius, segments, thetaStart, thetaLength]
    });
}

export function getTorusGeometry(
    radius: number = 1,
    tube: number = 0.4,
    radialSegments: number = 16,
    tubularSegments: number = 100,
    arc?: number
): THREE.BufferGeometry {
    return geometryRegistry.getOrCreate({
        type: 'TorusGeometry',
        args: [radius, tube, radialSegments, tubularSegments, arc]
    });
}

export function getTorusKnotGeometry(
    radius: number = 1,
    tube: number = 0.4,
    tubularSegments: number = 128,
    radialSegments: number = 16,
    p: number = 2,
    q: number = 3
): THREE.BufferGeometry {
    return geometryRegistry.getOrCreate({
        type: 'TorusKnotGeometry',
        args: [radius, tube, tubularSegments, radialSegments, p, q]
    });
}

export function getIcosahedronGeometry(
    radius: number = 1,
    detail?: number
): THREE.BufferGeometry {
    return geometryRegistry.getOrCreate({
        type: 'IcosahedronGeometry',
        args: [radius, detail]
    });
}

/**
 * Pre-configured common geometries used throughout the application
 * These replace the sharedGeometries object with deduplicated versions
 */
export const CommonGeometries = {
    // Unit geometries (base scale = 1)
    get unitSphere() { return getSphereGeometry(1, 16, 16); },
    get unitSphereLow() { return getSphereGeometry(1, 8, 8); },
    get unitCylinder() { 
        return geometryRegistry.getOrCreate({
            type: 'CylinderGeometry',
            args: [1, 1, 1, 12],
            translate: [0, 0.5, 0]
        });
    },
    get unitCylinderLow() {
        return geometryRegistry.getOrCreate({
            type: 'CylinderGeometry',
            args: [1, 1, 1, 8],
            translate: [0, 0.5, 0]
        });
    },
    get unitCone() {
        return geometryRegistry.getOrCreate({
            type: 'ConeGeometry',
            args: [1, 1, 16],
            translate: [0, 0.5, 0]
        });
    },
    get unitPlane() { return getPlaneGeometry(1, 1); },
    get unitBox() { return getBoxGeometry(1, 1, 1); },
    
    // Common sizes
    get capsule() { return getCapsuleGeometry(0.5, 1, 6, 8); },
    get eye() { return getSphereGeometry(0.12, 16, 16); },
    get pupil() { return getSphereGeometry(0.05, 12, 12); },
    
    // Mushroom parts
    get mushroomCap() {
        return geometryRegistry.getOrCreate({
            type: 'SphereGeometry',
            args: [1, 24, 24, 0, Math.PI * 2, 0, Math.PI / 1.8]
        });
    },
    get mushroomGillCenter() {
        return geometryRegistry.getOrCreate({
            type: 'ConeGeometry',
            args: [1, 1, 24, 1, true]
        });
    },
    get mushroomSmile() {
        return geometryRegistry.getOrCreate({
            type: 'TorusGeometry',
            args: [0.12, 0.04, 6, 12, Math.PI]
        });
    },
    
    // Berry sizes (commonly used)
    get berrySmall() { return getSphereGeometry(0.06, 16, 16); },
    get berryMedium() { return getSphereGeometry(0.1, 16, 16); },
    
    // Cloud puff
    get cloudPuff() { return getIcosahedronGeometry(1, 2); }
};

/**
 * Report geometry deduplication statistics to console
 * Call this after scene initialization to see savings
 */
export function reportGeometryStats(): void {
    const stats = geometryRegistry.getStats();
    const unique = geometryRegistry.getUniqueCount();
    const totalRefs = geometryRegistry.getTotalRefCount();
    
    console.log('=== Geometry Deduplication Report ===');
    console.log(`Cache hits:     ${stats.hits.toLocaleString()}`);
    console.log(`Cache misses:   ${stats.misses.toLocaleString()}`);
    console.log(`Hit rate:       ${stats.totalRequests > 0 ? ((stats.hits / stats.totalRequests) * 100).toFixed(1) : 0}%`);
    console.log(`Unique geometries: ${unique.toLocaleString()}`);
    console.log(`Total references:  ${totalRefs.toLocaleString()}`);
    console.log(`Memory saved:   ${(stats.memorySaved / 1024 / 1024).toFixed(2)} MB`);
    console.log('=====================================');
}

/**
 * Debug helper - list all registered geometries
 */
export function listRegisteredGeometries(): void {
    const entries = geometryRegistry.getAllEntries();
    console.log('=== Registered Geometries ===');
    entries.forEach(({ key, refCount, type }) => {
        console.log(`[${refCount}x] ${type}: ${key.substring(0, 80)}...`);
    });
    console.log(`Total: ${entries.length} unique geometries`);
}
