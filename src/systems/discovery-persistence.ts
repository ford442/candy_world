/**
 * @file discovery-persistence.ts
 * @brief LocalStorage persistence layer for the discovery system
 *
 * Provides timestamped discovery tracking, server synchronization,
 * conflict resolution, and export/import functionality.
 */

import { DISCOVERY_MAP, type DiscoveryItem } from './discovery_map.ts';

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Individual discovery record with metadata
 */
export interface PersistedDiscovery {
    id: string;
    timestamp: number;
    serverSyncTime?: number;
    metadata?: {
        displayName: string;
        icon: string;
    };
}

/**
 * Legacy discovery format (for migration)
 */
interface LegacyDiscoveryFormat {
    items?: string[];
    discoveries?: string[];
}

/**
 * Export format for backup/restore
 */
export interface DiscoveryExport {
    version: number;
    exportDate: string;
    discoveries: PersistedDiscovery[];
    stats: {
        totalDiscovered: number;
        firstDiscovery?: string;
        lastDiscovery?: string;
    };
}

/**
 * Internal storage format
 */
interface StorageFormat {
    version: number;
    lastModified: number;
    discoveries: PersistedDiscovery[];
}

/**
 * Import result with detailed status
 */
export interface ImportResult {
    success: boolean;
    imported: number;
    errors: string[];
    warnings: string[];
}

/**
 * Discovery statistics
 */
export interface DiscoveryStats {
    total: number;
    first: number | null;
    last: number | null;
    pendingSync: number;
}

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = 'candy_world_discovery_v2';
const LEGACY_STORAGE_KEY = 'candy_world_discovery';
const CURRENT_VERSION = 1;

// =============================================================================
// DiscoveryPersistence Class
// =============================================================================

/**
 * Manages persistence of discovered items with timestamp tracking,
 * server synchronization, and conflict resolution.
 */
export class DiscoveryPersistence {
    private readonly STORAGE_KEY: string;
    private discoveries: Map<string, PersistedDiscovery>;
    private isAvailable: boolean;

    constructor(storageKey: string = STORAGE_KEY) {
        this.STORAGE_KEY = storageKey;
        this.discoveries = new Map();
        this.isAvailable = this.checkStorageAvailability();
        this.load();
    }

    // =========================================================================
    // Storage Availability & Utilities
    // =========================================================================

    /**
     * Check if localStorage is available and working
     */
    private checkStorageAvailability(): boolean {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return false;
            }
            // Test write access
            const testKey = '__storage_test__';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
            return true;
        } catch (e) {
            console.warn('[DiscoveryPersistence] localStorage not available:', e);
            return false;
        }
    }

    /**
     * Get current timestamp
     */
    private now(): number {
        return Date.now();
    }

    /**
     * Create metadata for a discovery from the discovery map
     */
    private createMetadata(id: string): { displayName: string; icon: string } | undefined {
        const item = DISCOVERY_MAP[id];
        if (item) {
            return {
                displayName: item.name,
                icon: item.icon
            };
        }
        return undefined;
    }

    // =========================================================================
    // Core Persistence Operations
    // =========================================================================

    /**
     * Load discoveries from localStorage
     * Handles migration from legacy format and data validation
     */
    load(): void {
        if (!this.isAvailable) {
            console.log('[DiscoveryPersistence] Running in memory-only mode (localStorage unavailable)');
            return;
        }

        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            
            if (data) {
                // Try to parse new format
                const parsed: StorageFormat = JSON.parse(data);
                
                if (parsed.version === CURRENT_VERSION && Array.isArray(parsed.discoveries)) {
                    this.discoveries.clear();
                    for (const discovery of parsed.discoveries) {
                        if (this.validateDiscovery(discovery)) {
                            this.discoveries.set(discovery.id, discovery);
                        }
                    }
                    console.log(`[DiscoveryPersistence] Loaded ${this.discoveries.size} discoveries`);
                    return;
                }
            }

            // Try legacy migration
            this.migrateFromLegacy();

        } catch (e) {
            console.error('[DiscoveryPersistence] Failed to load discoveries:', e);
            this.discoveries.clear();
        }
    }

    /**
     * Save discoveries to localStorage
     * Handles quota exceeded and other storage errors gracefully
     */
    save(): void {
        if (!this.isAvailable) return;

        try {
            const storageData: StorageFormat = {
                version: CURRENT_VERSION,
                lastModified: this.now(),
                discoveries: Array.from(this.discoveries.values())
            };

            const serialized = JSON.stringify(storageData);
            localStorage.setItem(this.STORAGE_KEY, serialized);

        } catch (e) {
            if (e instanceof Error) {
                if (e.name === 'QuotaExceededError' || 
                    e.message?.includes('quota') ||
                    e.message?.includes('storage')) {
                    console.error('[DiscoveryPersistence] Storage quota exceeded. Consider clearing old data.');
                } else {
                    console.error('[DiscoveryPersistence] Failed to save discoveries:', e);
                }
            }
        }
    }

    /**
     * Validate a discovery record has required fields
     */
    private validateDiscovery(discovery: unknown): discovery is PersistedDiscovery {
        if (!discovery || typeof discovery !== 'object') return false;
        
        const d = discovery as Record<string, unknown>;
        return (
            typeof d.id === 'string' &&
            d.id.length > 0 &&
            typeof d.timestamp === 'number' &&
            d.timestamp > 0
        );
    }

    // =========================================================================
    // Migration
    // =========================================================================

    /**
     * Migrate discoveries from legacy format (simple string array)
     */
    private migrateFromLegacy(): void {
        try {
            const legacyData = localStorage.getItem(LEGACY_STORAGE_KEY);
            if (!legacyData) return;

            const parsed: LegacyDiscoveryFormat | string[] = JSON.parse(legacyData);
            const items: string[] = [];

            // Handle different legacy formats
            if (Array.isArray(parsed)) {
                items.push(...parsed);
            } else if (parsed.items && Array.isArray(parsed.items)) {
                items.push(...parsed.items);
            } else if (parsed.discoveries && Array.isArray(parsed.discoveries)) {
                items.push(...parsed.discoveries);
            }

            // Convert to new format with timestamps
            const now = this.now();
            for (const id of items) {
                if (typeof id === 'string' && !this.discoveries.has(id)) {
                    const discovery: PersistedDiscovery = {
                        id,
                        timestamp: now, // Use current time for migrated entries
                        metadata: this.createMetadata(id)
                    };
                    this.discoveries.set(id, discovery);
                }
            }

            console.log(`[DiscoveryPersistence] Migrated ${items.length} discoveries from legacy format`);
            
            // Save in new format and optionally remove old
            this.save();
            
            // Clean up legacy storage (optional - can be disabled for safety)
            // localStorage.removeItem(LEGACY_STORAGE_KEY);

        } catch (e) {
            console.warn('[DiscoveryPersistence] Legacy migration failed:', e);
        }
    }

    // =========================================================================
    // Discovery Management
    // =========================================================================

    /**
     * Add a new discovery with automatic timestamp and metadata
     * @returns true if this was a new discovery, false if already discovered
     */
    addDiscovery(id: string, displayName?: string, icon?: string): boolean {
        if (!id || this.discoveries.has(id)) {
            return false;
        }

        const discovery: PersistedDiscovery = {
            id,
            timestamp: this.now(),
            metadata: {
                displayName: displayName || DISCOVERY_MAP[id]?.name || id,
                icon: icon || DISCOVERY_MAP[id]?.icon || '🌿'
            }
        };

        this.discoveries.set(id, discovery);
        this.save();
        
        console.log(`[DiscoveryPersistence] New discovery: ${id} at ${new Date(discovery.timestamp).toISOString()}`);
        return true;
    }

    /**
     * Check if an item has been discovered
     */
    hasDiscovery(id: string): boolean {
        return this.discoveries.has(id);
    }

    /**
     * Get a specific discovery record
     */
    getDiscovery(id: string): PersistedDiscovery | undefined {
        return this.discoveries.get(id);
    }

    /**
     * Get all discoveries sorted by timestamp (newest first)
     */
    getAllDiscoveries(): PersistedDiscovery[] {
        return Array.from(this.discoveries.values())
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Get all discovery IDs (for compatibility with existing code)
     */
    getAllIds(): string[] {
        return Array.from(this.discoveries.keys());
    }

    /**
     * Remove a specific discovery
     */
    removeDiscovery(id: string): boolean {
        const existed = this.discoveries.delete(id);
        if (existed) {
            this.save();
        }
        return existed;
    }

    // =========================================================================
    // Server Synchronization
    // =========================================================================

    /**
     * Merge discoveries from server with local state
     * Conflict resolution: server wins if newer timestamp, local wins if newer
     */
    mergeWithServer(serverDiscoveries: PersistedDiscovery[]): void {
        let conflictsResolved = 0;
        let added = 0;
        let unchanged = 0;

        for (const serverDiscovery of serverDiscoveries) {
            if (!this.validateDiscovery(serverDiscovery)) {
                console.warn('[DiscoveryPersistence] Invalid server discovery:', serverDiscovery);
                continue;
            }

            const localDiscovery = this.discoveries.get(serverDiscovery.id);

            if (!localDiscovery) {
                // Server has discovery we don't have - add it
                this.discoveries.set(serverDiscovery.id, {
                    ...serverDiscovery,
                    serverSyncTime: this.now()
                });
                added++;

            } else {
                // Both have it - resolve conflict based on timestamp
                const serverTime = serverDiscovery.timestamp;
                const localTime = localDiscovery.timestamp;

                if (serverTime > localTime) {
                    // Server has newer version - use server
                    this.discoveries.set(serverDiscovery.id, {
                        ...serverDiscovery,
                        serverSyncTime: this.now()
                    });
                    conflictsResolved++;

                } else if (localTime > serverTime) {
                    // Local is newer - keep local, but mark as needing sync
                    // Local wins, no action needed
                    unchanged++;

                } else {
                    // Timestamps equal - merge metadata if needed
                    if (serverDiscovery.metadata && !localDiscovery.metadata) {
                        localDiscovery.metadata = serverDiscovery.metadata;
                    }
                    localDiscovery.serverSyncTime = this.now();
                    unchanged++;
                }
            }
        }

        if (added > 0 || conflictsResolved > 0) {
            this.save();
        }

        console.log(`[DiscoveryPersistence] Server merge: ${added} added, ${conflictsResolved} conflicts resolved (server won), ${unchanged} unchanged`);
    }

    /**
     * Get discoveries that are newer than the last server sync
     * These need to be sent to the server
     */
    getPendingSync(): PersistedDiscovery[] {
        const pending: PersistedDiscovery[] = [];
        
        for (const discovery of this.discoveries.values()) {
            // Pending if no serverSyncTime or local timestamp is newer than sync
            if (!discovery.serverSyncTime || discovery.timestamp > discovery.serverSyncTime) {
                pending.push(discovery);
            }
        }

        return pending.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Mark a discovery as successfully synced with server
     */
    markSynced(id: string): boolean {
        const discovery = this.discoveries.get(id);
        if (discovery) {
            discovery.serverSyncTime = this.now();
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Mark multiple discoveries as synced
     */
    markMultipleSynced(ids: string[]): number {
        let marked = 0;
        const now = this.now();

        for (const id of ids) {
            const discovery = this.discoveries.get(id);
            if (discovery) {
                discovery.serverSyncTime = now;
                marked++;
            }
        }

        if (marked > 0) {
            this.save();
        }

        return marked;
    }

    // =========================================================================
    // Export / Import
    // =========================================================================

    /**
     * Export all discoveries to JSON string for backup
     */
    exportToJSON(): string {
        const discoveries = this.getAllDiscoveries();
        const timestamps = discoveries.map(d => d.timestamp);
        
        const exportData: DiscoveryExport = {
            version: 1,
            exportDate: new Date().toISOString(),
            discoveries,
            stats: {
                totalDiscovered: discoveries.length,
                firstDiscovery: timestamps.length > 0 
                    ? new Date(Math.min(...timestamps)).toISOString() 
                    : undefined,
                lastDiscovery: timestamps.length > 0 
                    ? new Date(Math.max(...timestamps)).toISOString() 
                    : undefined
            }
        };

        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Import discoveries from JSON string
     * Validates data format and handles conflicts with existing discoveries
     */
    importFromJSON(json: string): ImportResult {
        const result: ImportResult = {
            success: false,
            imported: 0,
            errors: [],
            warnings: []
        };

        try {
            const parsed = JSON.parse(json);

            // Validate export format
            if (!parsed || typeof parsed !== 'object') {
                result.errors.push('Invalid JSON: not an object');
                return result;
            }

            if (typeof parsed.version !== 'number') {
                result.errors.push('Invalid format: missing version field');
                return result;
            }

            if (!Array.isArray(parsed.discoveries)) {
                result.errors.push('Invalid format: discoveries must be an array');
                return result;
            }

            // Version compatibility check
            if (parsed.version > CURRENT_VERSION) {
                result.warnings.push(`Import version (${parsed.version}) is newer than supported (${CURRENT_VERSION})`);
            }

            // Import each discovery
            const now = this.now();
            let skipped = 0;

            for (const discovery of parsed.discoveries) {
                if (!this.validateDiscovery(discovery)) {
                    result.errors.push(`Invalid discovery record: ${JSON.stringify(discovery)}`);
                    continue;
                }

                const existing = this.discoveries.get(discovery.id);

                if (existing) {
                    // Conflict: keep the one with older timestamp (original)
                    if (discovery.timestamp < existing.timestamp) {
                        this.discoveries.set(discovery.id, {
                            ...discovery,
                            serverSyncTime: discovery.serverSyncTime || existing.serverSyncTime
                        });
                        result.imported++;
                    } else {
                        skipped++;
                    }
                } else {
                    // New discovery
                    this.discoveries.set(discovery.id, discovery);
                    result.imported++;
                }
            }

            if (skipped > 0) {
                result.warnings.push(`${skipped} discoveries skipped (newer local version exists)`);
            }

            if (result.imported > 0) {
                this.save();
                result.success = true;
            } else if (result.errors.length === 0) {
                result.warnings.push('No new discoveries to import');
                result.success = true;
            }

        } catch (e) {
            result.errors.push(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
        }

        return result;
    }

    // =========================================================================
    // Utilities
    // =========================================================================

    /**
     * Clear all discoveries
     */
    clear(): void {
        this.discoveries.clear();
        
        if (this.isAvailable) {
            try {
                localStorage.removeItem(this.STORAGE_KEY);
                localStorage.removeItem(LEGACY_STORAGE_KEY);
            } catch (e) {
                console.warn('[DiscoveryPersistence] Failed to clear storage:', e);
            }
        }
        
        console.log('[DiscoveryPersistence] All discoveries cleared');
    }

    /**
     * Get discovery statistics
     */
    getStats(): DiscoveryStats {
        const discoveries = Array.from(this.discoveries.values());
        const timestamps = discoveries.map(d => d.timestamp);
        const pendingSync = this.getPendingSync();

        return {
            total: discoveries.length,
            first: timestamps.length > 0 ? Math.min(...timestamps) : null,
            last: timestamps.length > 0 ? Math.max(...timestamps) : null,
            pendingSync: pendingSync.length
        };
    }

    /**
     * Get count of discovered items
     */
    get count(): number {
        return this.discoveries.size;
    }

    /**
     * Check if persistence is available
     */
    get available(): boolean {
        return this.isAvailable;
    }

    /**
     * Force a reload from storage
     */
    reload(): void {
        this.discoveries.clear();
        this.load();
    }
}

// =============================================================================
// Singleton Instance & Convenience Exports
// =============================================================================

/**
 * Global singleton instance
 */
export const discoveryPersistence = new DiscoveryPersistence();

/**
 * Export discoveries to JSON string
 * @returns JSON string with all discoveries and metadata
 */
export function exportDiscoveries(): string {
    return discoveryPersistence.exportToJSON();
}

/**
 * Import discoveries from JSON string
 * @param json - JSON string from exportDiscoveries()
 * @returns Import result with success status and details
 */
export function importDiscoveries(json: string): ImportResult {
    return discoveryPersistence.importFromJSON(json);
}

/**
 * Clear all local discoveries (use with caution)
 */
export function clearLocalDiscoveries(): void {
    discoveryPersistence.clear();
}

/**
 * Get discovery statistics
 */
export function getDiscoveryStats(): DiscoveryStats {
    return discoveryPersistence.getStats();
}

/**
 * Check if localStorage persistence is available
 */
export function isPersistenceAvailable(): boolean {
    return discoveryPersistence.available;
}

// =============================================================================
// Backward Compatibility Helpers
// =============================================================================

/**
 * Convert discovery persistence to simple string array
 * Useful for compatibility with code expecting old format
 */
export function getDiscoveryIds(): string[] {
    return discoveryPersistence.getAllIds();
}

/**
 * Check if specific ID is discovered
 * Convenience function for quick checks
 */
export function isDiscovered(id: string): boolean {
    return discoveryPersistence.hasDiscovery(id);
}
