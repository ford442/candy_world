/**
 * Save Database - IndexedDB operations and migration system
 */

import {
    SAVE_VERSION,
    DB_NAME,
    DB_VERSION,
    STORE_NAME,
    SaveData,
    SaveSlotInfo,
    SettingsSaveData,
    MigrationFunction
} from './save-types.js';

// =============================================================================
// LZ-STRING COMPRESSION (Embedded to avoid dependency)
// =============================================================================

/**
 * Minimal LZ-string compression for localStorage
 * Based on lz-string library by pieroxy
 */
export const LZString = {
    compress: (input: string): string => {
        if (input == null) return '';
        let res = '';
        const dict: Record<string, number> = {};
        const data: (string | number)[] = [];
        let currChar: string;
        let subStr = '';
        let numBits = 3;
        let numBitsPrev = 2;
        let value: number;
        let pos = 1;
        let enlargeIn = 2;

        for (let i = 0; i < input.length; i += 1) {
            currChar = input.charAt(i);
            if (!Object.prototype.hasOwnProperty.call(dict, currChar)) {
                dict[currChar] = pos++;
                data.push(currChar);
            }
            subStr += currChar;
            if (dict[subStr] !== undefined) {
                continue;
            }
            value = dict[subStr.slice(0, -1)];
            res += String.fromCharCode(value);
            dict[subStr] = pos++;
            subStr = currChar;
        }
        if (subStr !== '') {
            res += String.fromCharCode(dict[subStr]);
        }
        return res;
    },

    decompress: (input: string): string => {
        if (input == '') return '';
        const dict: Record<number, string> = { 0: '' };
        let entry = '';
        let res = '';
        let w = '';
        let enlargeIn = 4;
        let dictSize = 4;
        let numBits = 3;
        let c = input.charCodeAt(0);
        let errorCount = 0;

        w = String.fromCharCode(c);
        res = w;
        for (let i = 1; i < input.length; i++) {
            c = input.charCodeAt(i);
            switch (c >> 8) {
                case 0:
                    entry = String.fromCharCode(c);
                    break;
                case 1:
                    throw new Error('LZString: Invalid character');
                default:
                    errorCount++;
                    if (errorCount > 100) throw new Error('LZString: Too many errors');
            }
            if (dict[c] !== undefined) {
                entry = dict[c];
            } else if (c === dictSize) {
                entry = w + w.charAt(0);
            } else {
                return '';
            }
            res += entry;
            dict[dictSize++] = w + entry.charAt(0);
            w = entry;
        }
        return res;
    }
};

// =============================================================================
// DATABASE MANAGEMENT
// =============================================================================

export class SaveDatabase {
    private db: IDBDatabase | null = null;
    private initPromise: Promise<void> | null = null;

    async init(): Promise<void> {
        if (this.initPromise) return this.initPromise;
        
        this.initPromise = new Promise((resolve, reject) => {
            const TIMEOUT_MS = 10000; // 10 second timeout for IndexedDB
            let timeoutId: number | null = null;
            
            const cleanup = () => {
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            };
            
            timeoutId = window.setTimeout(() => {
                cleanup();
                reject(new Error(`IndexedDB open timed out after ${TIMEOUT_MS}ms`));
            }, TIMEOUT_MS);
            
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                cleanup();
                reject(request.error);
            };
            
            request.onsuccess = () => {
                cleanup();
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'slotId' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('isAutoSave', 'isAutoSave', { unique: false });
                }
            };
        });

        return this.initPromise;
    }

    async save(slotId: string, data: SaveData): Promise<void> {
        await this.init();
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            
            // Compress large data fields
            const compressed = this.compressData(data);
            
            const request = store.put({
                slotId,
                timestamp: Date.now(),
                isAutoSave: data.metadata.isAutoSave,
                data: compressed
            });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async load(slotId: string): Promise<SaveData | null> {
        await this.init();
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(slotId);

            request.onsuccess = () => {
                if (request.result) {
                    resolve(this.decompressData(request.result.data));
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async delete(slotId: string): Promise<void> {
        await this.init();
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(slotId);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async listAll(): Promise<SaveSlotInfo[]> {
        await this.init();
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const slots: SaveSlotInfo[] = request.result.map((item: any) => ({
                    slotId: item.slotId,
                    slotName: item.data?.metadata?.slotName || item.slotId,
                    exists: true,
                    timestamp: item.timestamp,
                    playtime: item.data?.metadata?.playtime || 0,
                    isAutoSave: item.isAutoSave,
                    thumbnail: item.data?.metadata?.thumbnail
                }));
                resolve(slots);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async clearAll(): Promise<void> {
        await this.init();
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Cleanup old auto-saves and manage storage
     */
    async cleanup(maxAutoSaves: number = 3): Promise<void> {
        const slots = await this.listAll();
        const autoSaves = slots
            .filter(s => s.isAutoSave && s.exists)
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        
        // Delete oldest auto-saves beyond the limit
        const toDelete = autoSaves.slice(maxAutoSaves);
        for (const slot of toDelete) {
            await this.delete(slot.slotId);
        }
    }

    private compressData(data: SaveData): any {
        // For large fields, we could compress them here
        // For now, we store as-is since IDB can handle it
        return data;
    }

    private decompressData(data: any): SaveData {
        return data as SaveData;
    }
}

// =============================================================================
// MIGRATION SYSTEM
// =============================================================================

export class MigrationSystem {
    private migrations: Map<string, MigrationFunction> = new Map();

    registerMigration(toVersion: string, fn: MigrationFunction): void {
        this.migrations.set(toVersion, fn);
    }

    migrate(data: any, fromVersion: string): SaveData {
        if (!fromVersion) {
            // No version - treat as legacy data
            return this.migrateFromLegacy(data);
        }

        let currentVersion = fromVersion;
        let currentData = data;

        // Apply migrations in order
        const sortedVersions = Array.from(this.migrations.keys())
            .sort((a, b) => this.compareVersions(a, b));

        for (const version of sortedVersions) {
            if (this.compareVersions(currentVersion, version) < 0) {
                const migration = this.migrations.get(version)!;
                try {
                    currentData = migration(currentData, currentVersion);
                    currentVersion = version;
                    console.log(`[SaveSystem] Migrated save from ${fromVersion} to ${version}`);
                } catch (e) {
                    console.error(`[SaveSystem] Migration failed: ${currentVersion} -> ${version}`, e);
                    throw new Error(`Migration failed from ${currentVersion} to ${version}`);
                }
            }
        }

        return currentData as SaveData;
    }

    private migrateFromLegacy(data: any): SaveData {
        // Handle old localStorage-only saves
        console.log('[SaveSystem] Migrating from legacy format');
        
        const now = Date.now();
        return {
            metadata: {
                version: SAVE_VERSION,
                timestamp: now,
                playtime: data.playtime || 0,
                slotId: 'legacy-migrated',
                slotName: 'Legacy Save',
                isAutoSave: false
            },
            player: {
                position: data.position || { x: 0, y: 10, z: 0 },
                rotation: data.rotation || { x: 0, y: 0, z: 0 },
                velocity: { x: 0, y: 0, z: 0 },
                unlockedAbilities: data.unlocks || [],
                energy: data.energy || 10,
                maxEnergy: data.maxEnergy || 10,
                currentState: 'default',
                airJumpsLeft: 1,
                hasShield: false,
                isPhasing: false,
                isInvisible: false
            },
            world: {
                timeOfDay: data.timeOfDay || 0.5,
                weatherState: data.weatherState || 'clear',
                weatherIntensity: 0,
                stormCharge: 0,
                season: data.season || 'spring',
                seasonProgress: 0,
                moonPhase: 0
            },
            progress: {
                discoveredEntities: data.discoveredItems || [],
                collectionCounts: data.inventory || {},
                milestones: [],
                playtime: data.playtime || 0,
                unlocks: data.unlocks || [],
                inventory: data.inventory || {}
            },
            settings: this.getDefaultSettings()
        };
    }

    private compareVersions(a: string, b: string): number {
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);
        
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const partA = partsA[i] || 0;
            const partB = partsB[i] || 0;
            if (partA < partB) return -1;
            if (partA > partB) return 1;
        }
        return 0;
    }

    getDefaultSettings(): SettingsSaveData {
        return {
            graphicsQuality: 'high',
            drawDistance: 200,
            shadows: true,
            postProcessing: true,
            audioVolume: 0.8,
            musicVolume: 0.7,
            sfxVolume: 0.9,
            keyBindings: {
                forward: 'w',
                backward: 's',
                left: 'a',
                right: 'd',
                jump: ' ',
                sprint: 'shift',
                sneak: 'control',
                interact: 'e',
                dance: 'f',
                shield: 'q'
            },
            fov: 75,
            sensitivity: 1.0
        };
    }
}
