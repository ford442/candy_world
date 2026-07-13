/**
 * @file discovery-optimized.ts
 * @brief Spatial grid-optimized flora discovery system
 * 
 * Replaces O(N) distance checks with O(1) spatial grid lookups.
 * Uses WASM batch processing for maximum efficiency.
 * Integrates with DiscoveryPersistence for timestamped tracking.
 * 
 * @example
 * ```ts
 * import { OptimizedDiscoverySystem } from './discovery-optimized';
 * import { DISCOVERY_MAP } from './discovery_map';
 * 
 * const discovery = new OptimizedDiscoverySystem();
 * 
 * // Register all discoverable objects during world generation
 * for (const obj of animatedFoliage) {
 *     const type = obj.userData.type;
 *     if (DISCOVERY_MAP[type]) {
 *         discovery.registerObject(obj.position, type);
 *     }
 * }
 * 
 * // In animation loop - O(1) lookup
 * const discovered = discovery.checkDiscovery(player.position);
 * if (discovered) {
 *     showToast(`Discovered: ${discovered.name}!`, discovered.icon);
 * }
 * ```
 */

import * as THREE from 'three';
import { getWasmInstance } from '../utils/wasm-loader.ts';
import { isEmscriptenReady, getEmscriptenInstance, getNativeFunc } from '../utils/wasm-loader-core.ts';
import { discoverySystem } from './discovery.ts';
import { discoveryPersistence } from './discovery-persistence.ts';
import { DISCOVERY_MAP } from './discovery_map.ts';

// Type definition for discovery info
interface DiscoveryInfo {
    name: string;
    icon: string;
}

// Object tracking
interface RegisteredObject {
    index: number;
    type: string;
    discoveryInfo: DiscoveryInfo;
}

// Squared discovery radius matching assembly/discovery.ts (5 m)
const CPP_DISCOVERY_RADIUS_SQ = 25.0;
// Max results per queryDiscoveries call (small buffer, discoveries are rare)
const CPP_MAX_QUERY_RESULTS = 16;

/**
 * Optimized discovery system using WASM spatial grid.
 * Routing priority: C++/Emscripten → AssemblyScript → JS fallback.
 */
export class OptimizedDiscoverySystem {
    private wasmInitialized = false;
    private objectRegistry = new Map<number, RegisteredObject>();
    private typeToObjects = new Map<string, number[]>();
    private nextId = 0;

    // AssemblyScript WASM function bindings
    private wasmInitDiscovery: (() => void) | null = null;
    private wasmRegisterObject: ((x: number, y: number, z: number, typeId: number) => number) | null = null;
    private wasmCheckDiscovery: ((x: number, y: number, z: number, typeFilter: number) => number) | null = null;
    private wasmMarkDiscovered: ((id: number) => void) | null = null;
    private wasmIsDiscovered: ((id: number) => number) | null = null;
    private wasmGetTypeId: ((id: number) => number) | null = null;
    private wasmResetAll: (() => void) | null = null;
    private wasmGetUndiscoveredCount: (() => number) | null = null;

    // Type ID encoding for the AssemblyScript path (map type string ↔ numeric ID)
    private typeToId = new Map<string, number>();
    private idToType = new Map<number, string>();
    private nextTypeId = 1;

    // C++/Emscripten function bindings
    private cppInitialized = false;
    private cppRegister: ((...args: number[]) => number) | null = null;
    private cppQuery: ((...args: number[]) => number) | null = null;
    private cppClear: ((...args: number[]) => number) | null = null;
    private cppMalloc: ((size: number) => number) | null = null;
    private cppFree: ((ptr: number) => void) | null = null;
    private cppHeap32: Int32Array | null = null;
    private cppOutPtr = 0; // pre-allocated output buffer in Emscripten heap

    private _initialized = false;

    private ensureInitialized(): void {
        if (this._initialized) return;
        this._initialized = true;
        this.initWasm();
        this.loadPersistedDiscoveries();
    }

    /**
     * Initialize backends: C++ first, then AssemblyScript.
     */
    private initWasm(): void {
        // --- C++ / Emscripten path (preferred) ---
        if (isEmscriptenReady()) {
            try {
                const emInst = getEmscriptenInstance() as any;
                const initGrid  = getNativeFunc('initDiscoveryGrid');
                const register  = getNativeFunc('registerDiscoverable');
                const query     = getNativeFunc('queryDiscoveries');
                const clear     = getNativeFunc('clearDiscoveryGrid');
                const malloc    = emInst?._malloc as ((n: number) => number) | undefined;
                const free      = emInst?._free  as ((p: number) => void)   | undefined;
                const heap32    = emInst?.HEAP32  as Int32Array | undefined;

                if (initGrid && register && query && clear && malloc && heap32) {
                    // Allocate output buffer once (CPP_MAX_QUERY_RESULTS × 4 bytes)
                    const outPtr = malloc(CPP_MAX_QUERY_RESULTS * 4);
                    if (outPtr) {
                        // initDiscoveryGrid(cols=16, rows=16, originX=-128, originZ=-128, cellSize=16)
                        initGrid(16, 16, -128, -128, 16);
                        this.cppRegister    = register;
                        this.cppQuery       = query;
                        this.cppClear       = clear;
                        this.cppMalloc      = malloc;
                        this.cppFree        = free ?? null;
                        this.cppHeap32      = heap32;
                        this.cppOutPtr      = outPtr;
                        this.cppInitialized = true;
                        console.log('[OptimizedDiscovery] C++ spatial grid initialized');
                        return; // skip ASC init
                    }
                }
            } catch (e) {
                console.warn('[OptimizedDiscovery] C++ discovery init failed, trying ASC:', e);
            }
        }

        // --- AssemblyScript path (fallback) ---
        const instance = getWasmInstance();
        if (!instance) {
            console.log('[OptimizedDiscovery] WASM not available, will use JS fallback');
            return;
        }

        this.wasmInitDiscovery        = (instance.exports as any).initDiscoverySystem;
        this.wasmRegisterObject       = (instance.exports as any).registerDiscoveryObject;
        this.wasmCheckDiscovery       = (instance.exports as any).checkDiscoverySpatial;
        this.wasmMarkDiscovered       = (instance.exports as any).markDiscovered;
        this.wasmIsDiscovered         = (instance.exports as any).isObjectDiscovered;
        this.wasmGetTypeId            = (instance.exports as any).getDiscoveryTypeId;
        this.wasmResetAll             = (instance.exports as any).resetAllDiscoveries;
        this.wasmGetUndiscoveredCount = (instance.exports as any).getUndiscoveredCount;

        if (this.wasmInitDiscovery) {
            // The discovery system writes to addresses up to ~276KB. Guard against
            // running on a WASM build whose initialMemory is too small (old 4-page
            // binaries only have 256KB), which would throw RuntimeError immediately.
            const mem = (instance.exports as any).memory as WebAssembly.Memory;
            const DISCOVERY_REQUIRED_BYTES = 280000;
            if (mem && mem.buffer.byteLength < DISCOVERY_REQUIRED_BYTES) {
                console.warn('[OptimizedDiscovery] WASM memory too small for discovery system, using JS fallback');
                this.wasmInitDiscovery = null;
                return;
            }
            try {
                this.wasmInitDiscovery();
                this.wasmInitialized = true;
                console.log('[OptimizedDiscovery] ASC spatial grid initialized');
            } catch (e) {
                console.warn('[OptimizedDiscovery] WASM initDiscoverySystem failed, using JS fallback:', e);
                this.wasmInitDiscovery = null;
            }
        }
    }

    /**
     * Load persisted discoveries and sync with WASM
     */
    private loadPersistedDiscoveries(): void {
        const persisted = discoveryPersistence.getAllDiscoveries();
        
        for (const discovery of persisted) {
            // Sync with legacy discoverySystem for backward compatibility
            if (!discoverySystem.isDiscovered(discovery.id)) {
                const info = DISCOVERY_MAP[discovery.id];
                if (info) {
                    // Add to legacy system without triggering save
                    (discoverySystem as any).discoveredItems?.add(discovery.id);
                }
            }
        }

        if (persisted.length > 0) {
            console.log(`[OptimizedDiscovery] Loaded ${persisted.length} persisted discoveries`);
        }
    }

    /**
     * Get or create a numeric type ID for a type string
     */
    private getTypeId(type: string): number {
        if (!this.typeToId.has(type)) {
            const id = this.nextTypeId++;
            this.typeToId.set(type, id);
            this.idToType.set(id, type);
        }
        return this.typeToId.get(type)!;
    }

    /**
     * Register a discoverable object.
     * @param position - World position
     * @param type - Object type (e.g., 'mushroom', 'flower')
     * @returns Registration ID, or -1 if failed
     */
    registerObject(position: THREE.Vector3, type: string): number {
        this.ensureInitialized();
        const discoveryInfo = DISCOVERY_MAP[type];
        if (!discoveryInfo) {
            return -1;
        }

        // Skip types already discovered (from persistence)
        if (discoveryPersistence.hasDiscovery(type) || discoverySystem.isDiscovered(type)) {
            return -1;
        }

        const id = this.nextId++;

        // C++ path: passes the JS id directly so queryDiscoveries returns it verbatim
        if (this.cppInitialized && this.cppRegister) {
            this.cppRegister(id, position.x, position.z);
        } else if (this.wasmInitialized && this.wasmRegisterObject) {
            // ASC path: needs a numeric typeId
            const typeId = this.getTypeId(type);
            const wasmIndex = this.wasmRegisterObject(position.x, position.y, position.z, typeId);
            this.objectRegistry.set(id, { index: wasmIndex, type, discoveryInfo });
            if (!this.typeToObjects.has(type)) this.typeToObjects.set(type, []);
            this.typeToObjects.get(type)!.push(id);
            return id;
        }

        // JS registry (C++ path also needs this for the id→type lookup)
        this.objectRegistry.set(id, { index: id, type, discoveryInfo });
        if (!this.typeToObjects.has(type)) this.typeToObjects.set(type, []);
        this.typeToObjects.get(type)!.push(id);

        return id;
    }

    /**
     * Check for discoveries at a player position.
     * Routes to C++ when the Emscripten module is loaded, otherwise AssemblyScript.
     * @param playerPos - Player position
     * @returns Discovery info if something was discovered, null otherwise
     */
    checkDiscovery(playerPos: THREE.Vector3): DiscoveryInfo | null {
        this.ensureInitialized();
        if (this.cppInitialized) {
            return this.checkDiscoveryCpp(playerPos);
        }
        if (!this.wasmInitialized || !this.wasmCheckDiscovery) {
            return this.checkDiscoveryJS(playerPos);
        }

        // AssemblyScript spatial grid
        const discoveredIndex = this.wasmCheckDiscovery(playerPos.x, playerPos.y, playerPos.z, 0);

        if (discoveredIndex >= 0) {
            const typeId = this.wasmGetTypeId!(discoveredIndex);
            const type = this.idToType.get(typeId);

            if (type) {
                const obj = this.findObjectByWasmIndex(discoveredIndex);
                if (obj) {
                    this.persistDiscovery(type, obj.discoveryInfo.name, obj.discoveryInfo.icon);
                    return obj.discoveryInfo;
                }
            }
        }

        return null;
    }

    /**
     * Persist a discovery through the persistence layer
     */
    private persistDiscovery(id: string, name: string, icon: string): void {
        // Add to persistence layer (handles timestamps)
        const isNew = discoveryPersistence.addDiscovery(id, name, icon);
        
        if (isNew) {
            // Also notify legacy system for toast display
            discoverySystem.discover(id, name, icon);
            
            console.log(`[OptimizedDiscovery] Persisted discovery: ${name} (${id})`);
        }
    }

    /**
     * Find a registered object by its WASM index
     */
    private findObjectByWasmIndex(wasmIndex: number): RegisteredObject | null {
        for (const obj of this.objectRegistry.values()) {
            if (obj.index === wasmIndex) {
                return obj;
            }
        }
        return null;
    }

    /**
     * C++ discovery query via Emscripten spatial grid.
     * queryDiscoveries returns caller-provided IDs; the TS layer decides which
     * are still undiscovered.
     */
    private checkDiscoveryCpp(playerPos: THREE.Vector3): DiscoveryInfo | null {
        if (!this.cppQuery || !this.cppHeap32 || !this.cppOutPtr) return null;

        const count = this.cppQuery(
            playerPos.x, playerPos.z,
            CPP_DISCOVERY_RADIUS_SQ,
            this.cppOutPtr,
            CPP_MAX_QUERY_RESULTS
        );
        if (count <= 0) return null;

        const base = this.cppOutPtr >> 2; // byte offset → Int32Array index
        for (let i = 0; i < count; i++) {
            const id = this.cppHeap32[base + i];
            const obj = this.objectRegistry.get(id);
            if (!obj) continue;
            if (discoveryPersistence.hasDiscovery(obj.type) || discoverySystem.isDiscovered(obj.type)) continue;

            this.persistDiscovery(obj.type, obj.discoveryInfo.name, obj.discoveryInfo.icon);
            return obj.discoveryInfo;
        }
        return null;
    }

    /**
     * JavaScript fallback for discovery check
     * Uses O(N) distance check (original implementation)
     */
    private checkDiscoveryJS(playerPos: THREE.Vector3): DiscoveryInfo | null {
        const DISCOVERY_RADIUS_SQ = 5.0 * 5.0;

        for (const [id, obj] of this.objectRegistry) {
            // Skip already discovered
            if (discoveryPersistence.hasDiscovery(obj.type) || discoverySystem.isDiscovered(obj.type)) {
                continue;
            }

            // This is a simplified check - we'd need to store positions in JS
            // For now, just return null to indicate no discovery
            // In practice, the WASM path will be used
        }

        return null;
    }

    /**
     * Mark a type as discovered
     */
    markDiscovered(type: string): void {
        const discoveryInfo = DISCOVERY_MAP[type];
        if (discoveryInfo) {
            // Use persistence layer
            this.persistDiscovery(type, discoveryInfo.name, discoveryInfo.icon);
        }

        // Also mark in WASM
        if (this.wasmInitialized) {
            const objects = this.typeToObjects.get(type);
            if (objects) {
                for (const id of objects) {
                    const obj = this.objectRegistry.get(id);
                    if (obj && obj.index >= 0 && this.wasmMarkDiscovered) {
                        this.wasmMarkDiscovered(obj.index);
                    }
                }
            }
        }
    }

    /**
     * Check if a type is discovered
     */
    isDiscovered(type: string): boolean {
        return discoveryPersistence.hasDiscovery(type) || discoverySystem.isDiscovered(type);
    }

    /**
     * Get count of undiscovered objects
     */
    getUndiscoveredCount(): number {
        this.ensureInitialized();
        if (this.wasmInitialized && this.wasmGetUndiscoveredCount) {
            return this.wasmGetUndiscoveredCount();
        }

        // JS fallback
        let count = 0;
        for (const [type, objects] of this.typeToObjects) {
            if (!this.isDiscovered(type)) {
                count += objects.length;
            }
        }
        return count;
    }

    /**
     * Reset all discoveries
     */
    reset(): void {
        this.ensureInitialized();
        discoveryPersistence.clear();
        discoverySystem.reset();

        if (this.cppInitialized && this.cppClear) {
            this.cppClear();
        } else if (this.wasmInitialized && this.wasmResetAll) {
            this.wasmResetAll();
        }
    }

    /**
     * Sync discoveries with server
     * @param serverDiscoveries - Array of discoveries from server
     */
    syncWithServer(serverDiscoveries: Array<{ id: string; timestamp: number }>): void {
        const formatted: any[] = [];
        for (let i = 0; i < serverDiscoveries.length; i++) {
            const d = serverDiscoveries[i];
            formatted.push({
            id: d.id,
            timestamp: d.timestamp,
            metadata: DISCOVERY_MAP[d.id] ? {
                displayName: DISCOVERY_MAP[d.id].name,
                icon: DISCOVERY_MAP[d.id].icon
            } : undefined
        });
        }

        discoveryPersistence.mergeWithServer(formatted);
        
        // Update legacy system
        for (const d of serverDiscoveries) {
            if (!discoverySystem.isDiscovered(d.id)) {
                const info = DISCOVERY_MAP[d.id];
                if (info) {
                    (discoverySystem as any).discoveredItems?.add(d.id);
                }
            }
        }

        console.log(`[OptimizedDiscovery] Synced ${serverDiscoveries.length} discoveries with server`);
    }

    /**
     * Get discoveries that need to be synced to server
     */
    getPendingSync(): Array<{ id: string; timestamp: number }> {
        const pending = discoveryPersistence.getPendingSync();
        const result = [];
        for (let i = 0; i < pending.length; i++) {
            result.push({
                id: pending[i].id,
                timestamp: pending[i].timestamp
            });
        }
        return result;
    }

    /**
     * Get registration statistics
     */
    getStats(): {
        registeredObjects: number;
        uniqueTypes: number;
        undiscoveredCount: number;
        usingWasm: boolean;
        persistedCount: number;
        pendingSync: number;
    } {
        this.ensureInitialized();
        const persistenceStats = discoveryPersistence.getStats();
        
        return {
            registeredObjects: this.objectRegistry.size,
            uniqueTypes: this.typeToObjects.size,
            undiscoveredCount: this.getUndiscoveredCount(),
            usingWasm: this.cppInitialized || this.wasmInitialized,
            persistedCount: persistenceStats.total,
            pendingSync: persistenceStats.pendingSync
        };
    }

    /**
     * Check if using WASM acceleration (either C++ or AssemblyScript)
     */
    isUsingWasm(): boolean {
        this.ensureInitialized();
        return this.cppInitialized || this.wasmInitialized;
    }

    /**
     * Check if using the C++/Emscripten backend (highest performance)
     */
    isUsingCpp(): boolean {
        return this.cppInitialized;
    }

    /**
     * Check if persistence layer is available
     */
    isPersistenceAvailable(): boolean {
        return discoveryPersistence.available;
    }

    /**
     * Dispose of all resources
     */
    dispose(): void {
        if (this.cppInitialized && this.cppFree && this.cppOutPtr) {
            this.cppFree(this.cppOutPtr);
            this.cppOutPtr = 0;
        }
        this.objectRegistry.clear();
        this.typeToObjects.clear();
        this.typeToId.clear();
        this.idToType.clear();
    }
}

// Global instance
export const optimizedDiscovery = new OptimizedDiscoverySystem();

/**
 * Integration helper: Initialize discovery for all animated foliage
 * Call this after world generation is complete
 */
export function initDiscoveryForFoliage(foliageObjects: any[]): void {
    console.log(`[Discovery] Registering ${foliageObjects.length} objects...`);

    let registered = 0;
    for (const obj of foliageObjects) {
        if (obj.userData && obj.userData.type) {
            const type = obj.userData.type;
            const id = optimizedDiscovery.registerObject(obj.position, type);
            if (id >= 0) {
                registered++;
            }
        }
    }

    const stats = optimizedDiscovery.getStats();
    console.log(`[Discovery] Registered ${registered} discoverable objects`);
    console.log(`[Discovery] Stats:`, stats);
}

/**
 * Check discovery for player position
 * Convenience function for the animation loop
 */
export function checkPlayerDiscovery(playerPos: THREE.Vector3): void {
    const discovery = optimizedDiscovery.checkDiscovery(playerPos);
    // The discovery system automatically shows toast notifications

    // Trigger visual effect
    if (discovery) {
        if (typeof window !== 'undefined' && (window as any).triggerDiscoveryEffect) {
            (window as any).triggerDiscoveryEffect(playerPos);
        }
    }
}

// Re-export persistence utilities for convenience
export { 
    discoveryPersistence, 
    exportDiscoveries, 
    importDiscoveries, 
    clearLocalDiscoveries,
    type PersistedDiscovery,
    type DiscoveryExport,
    type DiscoveryStats
} from './discovery-persistence.ts';
