/**
 * Save System - Comprehensive save/load persistence for Candy World
 * 
 * Features:
 * - Dual storage backends: localStorage (sync) + IndexedDB (async)
 * - Compression with LZ-string for localStorage, optional pako for IDB
 * - Auto-save every 30s + on important events
 * - Manual save slots (5) + rotating auto-saves (3)
 * - Export/import as JSON files
 * - Migration system for version upgrades
 * - Corrupted save handling with graceful fallback
 */

import { showToast } from '../utils/toast.js';

// =============================================================================
// CONSTANTS & CONFIG
// =============================================================================

const SAVE_VERSION = '1.0.0';
const DB_NAME = 'CandyWorldSaveDB';
const DB_VERSION = 1;
const STORE_NAME = 'saves';

const AUTO_SAVE_INTERVAL = 30000; // 30 seconds
const AUTO_SAVE_SLOTS = 3;
const MANUAL_SAVE_SLOTS = 5;

const LOCALSTORAGE_KEY_SETTINGS = 'candy_world_settings';
const LOCALSTORAGE_KEY_METADATA = 'candy_world_save_metadata';

// Compression constants
const COMPRESSION_THRESHOLD = 1024; // Bytes below which we don't compress

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Vector3 representation for serialization
 */
export interface SerializableVector3 {
    x: number;
    y: number;
    z: number;
}

/**
 * Player state for save data
 */
export interface PlayerSaveData {
    position: SerializableVector3;
    rotation: SerializableVector3;
    velocity: SerializableVector3;
    unlockedAbilities: string[];
    energy: number;
    maxEnergy: number;
    currentState: string;
    airJumpsLeft: number;
    hasShield: boolean;
    isPhasing: boolean;
    isInvisible: boolean;
}

/**
 * World state for save data
 */
export interface WorldSaveData {
    timeOfDay: number; // 0-1, where 0 is midnight, 0.5 is noon
    weatherState: 'clear' | 'rain' | 'storm';
    weatherIntensity: number;
    stormCharge: number;
    season: string;
    seasonProgress: number;
    moonPhase: number;
}

/**
 * Progress tracking for save data
 */
export interface ProgressSaveData {
    discoveredEntities: string[];
    collectionCounts: Record<string, number>;
    milestones: string[];
    playtime: number; // Total playtime in seconds
    unlocks: string[];
    inventory: Record<string, number>;
}

/**
 * Key bindings for save data
 */
export interface KeyBindings {
    forward: string;
    backward: string;
    left: string;
    right: string;
    jump: string;
    sprint: string;
    sneak: string;
    interact: string;
    dance: string;
    shield: string;
}

/**
 * Settings for save data
 */
export interface SettingsSaveData {
    graphicsQuality: 'low' | 'medium' | 'high' | 'ultra';
    drawDistance: number;
    shadows: boolean;
    postProcessing: boolean;
    audioVolume: number; // 0-1
    musicVolume: number; // 0-1
    sfxVolume: number; // 0-1
    keyBindings: KeyBindings;
    fov: number;
    sensitivity: number;
}

/**
 * Save metadata
 */
export interface SaveMetadata {
    version: string;
    timestamp: number;
    playtime: number;
    slotId: string;
    slotName: string;
    isAutoSave: boolean;
    thumbnail?: string; // Base64 encoded screenshot (optional)
}

/**
 * Complete save data structure
 */
export interface SaveData {
    metadata: SaveMetadata;
    player: PlayerSaveData;
    world: WorldSaveData;
    progress: ProgressSaveData;
    settings: SettingsSaveData;
}

/**
 * Save slot information (without full data)
 */
export interface SaveSlotInfo {
    slotId: string;
    slotName: string;
    exists: boolean;
    timestamp?: number;
    playtime?: number;
    isAutoSave: boolean;
    thumbnail?: string;
}

/**
 * Migration function type
 */
type MigrationFunction = (data: any, fromVersion: string) => any;

// =============================================================================
// LZ-STRING COMPRESSION (Embedded to avoid dependency)
// =============================================================================

/**
 * Minimal LZ-string compression for localStorage
 * Based on lz-string library by pieroxy
 */
const LZString = {
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

class SaveDatabase {
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

class MigrationSystem {
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

// =============================================================================
// MAIN SAVE SYSTEM
// =============================================================================

class SaveSystem {
    private db: SaveDatabase;
    private migrations: MigrationSystem;
    private autoSaveTimer: number | null = null;
    private sessionStartTime: number = Date.now();
    private isSaving: boolean = false;
    private saveIndicator: HTMLElement | null = null;
    private settings: SettingsSaveData;
    private lastSaveTime: number = 0;
    private currentSlotId: string | null = null;

    // Callbacks for game integration
    public onSaveStart: (() => void) | null = null;
    public onSaveComplete: (() => void) | null = null;
    public onSaveError: ((error: Error) => void) | null = null;
    public onLoadStart: (() => void) | null = null;
    public onLoadComplete: ((data: SaveData) => void) | null = null;
    public onLoadError: ((error: Error) => void) | null = null;

    constructor() {
        this.db = new SaveDatabase();
        this.migrations = new MigrationSystem();
        this.settings = this.loadSettingsSync();
        this.initMigrations();
        this.createSaveIndicator();
        this.startAutoSave();
        this.setupKeyboardShortcuts();
    }

    // -------------------------------------------------------------------------
    // INITIALIZATION
    // -------------------------------------------------------------------------

    private initMigrations(): void {
        // Register future migrations here
        // Example:
        // this.migrations.registerMigration('1.1.0', (data, fromVersion) => { ... });
    }

    private createSaveIndicator(): void {
        this.saveIndicator = document.createElement('div');
        this.saveIndicator.id = 'save-indicator';
        this.saveIndicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 24px;
            height: 24px;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234ade80"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>') center/contain no-repeat;
            opacity: 0;
            transition: opacity 0.3s ease;
            z-index: 10000;
            pointer-events: none;
        `;
        document.body.appendChild(this.saveIndicator);
    }

    private setupKeyboardShortcuts(): void {
        document.addEventListener('keydown', (e) => {
            // Ctrl+S for manual save
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.saveToManualSlot('quick-save');
            }
        });
    }

    // -------------------------------------------------------------------------
    // CORE SAVE/LOAD OPERATIONS
    // -------------------------------------------------------------------------

    /**
     * Save game to a specific slot
     */
    async save(slotId: string, slotName?: string): Promise<boolean> {
        if (this.isSaving) {
            console.log('[SaveSystem] Save already in progress, skipping');
            return false;
        }

        this.isSaving = true;
        this.showSaveIndicator();
        this.onSaveStart?.();

        try {
            const saveData = await this.gatherSaveData(slotId, slotName);
            await this.db.save(slotId, saveData);
            this.currentSlotId = slotId;
            this.lastSaveTime = Date.now();
            
            // Also save settings to localStorage for quick access
            this.saveSettingsSync(saveData.settings);
            
            console.log(`[SaveSystem] Saved to slot: ${slotId}`);
            this.onSaveComplete?.();
            return true;
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.error('[SaveSystem] Save failed:', error);
            this.onSaveError?.(error);
            return false;
        } finally {
            this.isSaving = false;
            this.hideSaveIndicator();
        }
    }

    /**
     * Load game from a specific slot
     */
    async load(slotId: string): Promise<SaveData | null> {
        this.onLoadStart?.();

        try {
            const rawData = await this.db.load(slotId);
            
            if (!rawData) {
                console.warn(`[SaveSystem] No save found in slot: ${slotId}`);
                return null;
            }

            // Version check and migration
            const fromVersion = rawData.metadata?.version || '0.0.0';
            let saveData: SaveData;

            if (fromVersion !== SAVE_VERSION) {
                saveData = this.migrations.migrate(rawData, fromVersion);
                // Update metadata after migration
                saveData.metadata.version = SAVE_VERSION;
                saveData.metadata.timestamp = Date.now();
            } else {
                saveData = rawData;
            }

            this.currentSlotId = slotId;
            this.sessionStartTime = Date.now() - (saveData.progress.playtime * 1000);
            
            console.log(`[SaveSystem] Loaded from slot: ${slotId}`);
            this.onLoadComplete?.(saveData);
            return saveData;
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.error('[SaveSystem] Load failed:', error);
            
            // Graceful fallback
            if (this.onLoadError) {
                this.onLoadError(error);
            } else {
                showToast('Failed to load save file', '⚠️', 5000);
            }
            return null;
        }
    }

    /**
     * Quick save to rotating auto-save slot
     */
    async autoSave(): Promise<boolean> {
        const slotIndex = Math.floor(Date.now() / AUTO_SAVE_INTERVAL) % AUTO_SAVE_SLOTS;
        const slotId = `auto-${slotIndex}`;
        return this.save(slotId, `Auto Save ${slotIndex + 1}`);
    }

    /**
     * Save to a manual slot
     */
    async saveToManualSlot(slotId: string): Promise<boolean> {
        const exists = await this.db.load(slotId);
        const slotName = exists ? exists.metadata.slotName : `Manual Save ${slotId}`;
        const result = await this.save(slotId, slotName);
        if (result) {
            showToast(`Game saved: ${slotName}`, '💾', 3000);
        }
        return result;
    }

    // -------------------------------------------------------------------------
    // DATA GATHERING (Game Integration Points)
    // -------------------------------------------------------------------------

    /**
     * Gather all game data for saving
     * This is where we collect data from all game systems
     */
    private async gatherSaveData(slotId: string, slotName?: string): Promise<SaveData> {
        const now = Date.now();
        const totalPlaytime = this.calculateTotalPlaytime();

        const metadata: SaveMetadata = {
            version: SAVE_VERSION,
            timestamp: now,
            playtime: totalPlaytime,
            slotId,
            slotName: slotName || slotId,
            isAutoSave: slotId.startsWith('auto-')
        };

        // Player data - will be populated by game systems
        const player = this.gatherPlayerData();

        // World data - will be populated by game systems
        const world = this.gatherWorldData();

        // Progress data - will be populated by game systems
        const progress = this.gatherProgressData(totalPlaytime);

        // Settings
        const settings = this.settings;

        return {
            metadata,
            player,
            world,
            progress,
            settings
        };
    }

    /**
     * Gather player data from game systems
     * This should be called by the game to provide current player state
     */
    private gatherPlayerData(): PlayerSaveData {
        // Return default if no game integration yet
        return {
            position: { x: 0, y: 10, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            velocity: { x: 0, y: 0, z: 0 },
            unlockedAbilities: [],
            energy: 10,
            maxEnergy: 10,
            currentState: 'default',
            airJumpsLeft: 1,
            hasShield: false,
            isPhasing: false,
            isInvisible: false
        };
    }

    /**
     * Gather world data from game systems
     */
    private gatherWorldData(): WorldSaveData {
        return {
            timeOfDay: 0.5,
            weatherState: 'clear',
            weatherIntensity: 0,
            stormCharge: 0,
            season: 'spring',
            seasonProgress: 0,
            moonPhase: 0
        };
    }

    /**
     * Gather progress data from game systems
     */
    private gatherProgressData(playtime: number): ProgressSaveData {
        return {
            discoveredEntities: [],
            collectionCounts: {},
            milestones: [],
            playtime,
            unlocks: [],
            inventory: {}
        };
    }

    // -------------------------------------------------------------------------
    // SETTINGS MANAGEMENT (localStorage - sync)
    // -------------------------------------------------------------------------

    private saveSettingsSync(settings: SettingsSaveData): void {
        try {
            const compressed = LZString.compress(JSON.stringify(settings));
            localStorage.setItem(LOCALSTORAGE_KEY_SETTINGS, compressed);
        } catch (e) {
            console.warn('[SaveSystem] Failed to save settings:', e);
        }
    }

    private loadSettingsSync(): SettingsSaveData {
        try {
            const compressed = localStorage.getItem(LOCALSTORAGE_KEY_SETTINGS);
            if (compressed) {
                const decompressed = LZString.decompress(compressed);
                if (decompressed) {
                    return JSON.parse(decompressed) as SettingsSaveData;
                }
            }
        } catch (e) {
            console.warn('[SaveSystem] Failed to load settings:', e);
        }
        return this.migrations.getDefaultSettings();
    }

    getSettings(): SettingsSaveData {
        return { ...this.settings };
    }

    updateSettings(newSettings: Partial<SettingsSaveData>): void {
        this.settings = { ...this.settings, ...newSettings };
        this.saveSettingsSync(this.settings);
    }

    // -------------------------------------------------------------------------
    // AUTO-SAVE SYSTEM
    // -------------------------------------------------------------------------

    private startAutoSave(): void {
        this.autoSaveTimer = window.setInterval(() => {
            this.autoSave();
        }, AUTO_SAVE_INTERVAL);
    }

    stopAutoSave(): void {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }

    // -------------------------------------------------------------------------
    // SLOT MANAGEMENT
    // -------------------------------------------------------------------------

    /**
     * Get list of all save slots
     */
    async listSlots(): Promise<SaveSlotInfo[]> {
        const slots = await this.db.listAll();
        
        // Ensure we have entries for all manual and auto slots
        const allSlots: SaveSlotInfo[] = [];
        
        // Add manual slots
        for (let i = 1; i <= MANUAL_SAVE_SLOTS; i++) {
            const slotId = `manual-${i}`;
            const existing = slots.find(s => s.slotId === slotId);
            if (existing) {
                allSlots.push(existing);
            } else {
                allSlots.push({
                    slotId,
                    slotName: `Manual Save ${i}`,
                    exists: false,
                    isAutoSave: false
                });
            }
        }
        
        // Add auto slots
        for (let i = 0; i < AUTO_SAVE_SLOTS; i++) {
            const slotId = `auto-${i}`;
            const existing = slots.find(s => s.slotId === slotId);
            if (existing) {
                allSlots.push(existing);
            } else {
                allSlots.push({
                    slotId,
                    slotName: `Auto Save ${i + 1}`,
                    exists: false,
                    isAutoSave: true
                });
            }
        }
        
        // Sort: manual first (by number), then auto
        return allSlots.sort((a, b) => {
            const aManual = a.slotId.startsWith('manual-');
            const bManual = b.slotId.startsWith('manual-');
            if (aManual && !bManual) return -1;
            if (!aManual && bManual) return 1;
            return a.slotId.localeCompare(b.slotId);
        });
    }

    /**
     * Delete a specific save slot
     */
    async deleteSlot(slotId: string): Promise<boolean> {
        try {
            await this.db.delete(slotId);
            console.log(`[SaveSystem] Deleted slot: ${slotId}`);
            return true;
        } catch (e) {
            console.error('[SaveSystem] Failed to delete slot:', e);
            return false;
        }
    }

    /**
     * Delete all save data
     */
    async deleteAllData(): Promise<boolean> {
        try {
            await this.db.clearAll();
            localStorage.removeItem(LOCALSTORAGE_KEY_SETTINGS);
            localStorage.removeItem(LOCALSTORAGE_KEY_METADATA);
            console.log('[SaveSystem] All data deleted');
            return true;
        } catch (e) {
            console.error('[SaveSystem] Failed to delete all data:', e);
            return false;
        }
    }

    // -------------------------------------------------------------------------
    // EXPORT/IMPORT
    // -------------------------------------------------------------------------

    /**
     * Export save data to JSON string
     */
    async exportSave(slotId: string): Promise<string | null> {
        try {
            const data = await this.db.load(slotId);
            if (!data) return null;
            return JSON.stringify(data, null, 2);
        } catch (e) {
            console.error('[SaveSystem] Export failed:', e);
            return null;
        }
    }

    /**
     * Export all saves as a bundle
     */
    async exportAllSaves(): Promise<string | null> {
        try {
            const slots = await this.db.listAll();
            const bundle: Record<string, SaveData> = {};
            
            for (const slot of slots) {
                const data = await this.db.load(slot.slotId);
                if (data) {
                    bundle[slot.slotId] = data;
                }
            }
            
            return JSON.stringify({
                exportVersion: SAVE_VERSION,
                exportedAt: Date.now(),
                saves: bundle
            }, null, 2);
        } catch (e) {
            console.error('[SaveSystem] Export all failed:', e);
            return null;
        }
    }

    /**
     * Import save data from JSON string
     */
    async importSave(jsonString: string, targetSlotId?: string): Promise<boolean> {
        try {
            const parsed = JSON.parse(jsonString);
            
            // Check if this is a bundle export
            if (parsed.saves && typeof parsed.saves === 'object') {
                // Import all saves from bundle
                for (const [slotId, data] of Object.entries(parsed.saves)) {
                    await this.db.save(slotId, data as SaveData);
                }
                showToast('Import complete: All saves restored', '📥', 5000);
                return true;
            }
            
            // Single save import
            const slotId = targetSlotId || parsed.metadata?.slotId || `imported-${Date.now()}`;
            await this.db.save(slotId, parsed as SaveData);
            showToast(`Import complete: ${parsed.metadata?.slotName || slotId}`, '📥', 5000);
            return true;
        } catch (e) {
            console.error('[SaveSystem] Import failed:', e);
            showToast('Import failed: Invalid save file', '❌', 5000);
            return false;
        }
    }

    /**
     * Copy save data to clipboard
     */
    async copyToClipboard(slotId: string): Promise<boolean> {
        const data = await this.exportSave(slotId);
        if (!data) return false;
        
        try {
            await navigator.clipboard.writeText(data);
            showToast('Save data copied to clipboard', '📋', 3000);
            return true;
        } catch (e) {
            console.error('[SaveSystem] Copy to clipboard failed:', e);
            return false;
        }
    }

    // -------------------------------------------------------------------------
    // EVENT TRIGGERS (Called by game systems)
    // -------------------------------------------------------------------------

    /**
     * Trigger a save on important events (discovery, unlock, etc.)
     */
    triggerEventSave(eventType: string): void {
        console.log(`[SaveSystem] Event save triggered: ${eventType}`);
        // Debounce event saves to avoid rapid successive saves
        if (Date.now() - this.lastSaveTime > 5000) {
            this.autoSave();
        }
    }

    // -------------------------------------------------------------------------
    // UTILITY METHODS
    // -------------------------------------------------------------------------

    private calculateTotalPlaytime(): number {
        const sessionTime = (Date.now() - this.sessionStartTime) / 1000;
        // Add any previously saved playtime (would come from current save)
        return Math.floor(sessionTime);
    }

    private showSaveIndicator(): void {
        if (this.saveIndicator) {
            this.saveIndicator.style.opacity = '1';
        }
    }

    private hideSaveIndicator(): void {
        // Keep visible briefly then fade
        setTimeout(() => {
            if (this.saveIndicator) {
                this.saveIndicator.style.opacity = '0';
            }
        }, 1000);
    }

    getCurrentSlotId(): string | null {
        return this.currentSlotId;
    }

    getLastSaveTime(): number {
        return this.lastSaveTime;
    }

    /**
     * Get estimated storage usage
     */
    async getStorageUsage(): Promise<{ used: number; quota: number | null }> {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            try {
                const estimate = await navigator.storage.estimate();
                return {
                    used: estimate.usage || 0,
                    quota: estimate.quota || null
                };
            } catch (e) {
                console.warn('[SaveSystem] Storage estimate failed:', e);
            }
        }
        return { used: 0, quota: null };
    }
}

// =============================================================================
// GAME INTEGRATION HELPERS
// =============================================================================

/**
 * Create a player data object from game state
 */
export function createPlayerSaveData(
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    gameState: {
        unlockedAbilities?: string[];
        energy?: number;
        maxEnergy?: number;
        currentState?: string;
        airJumpsLeft?: number;
        hasShield?: boolean;
        isPhasing?: boolean;
        isInvisible?: boolean;
    }
): PlayerSaveData {
    return {
        position,
        rotation,
        velocity,
        unlockedAbilities: gameState.unlockedAbilities || [],
        energy: gameState.energy || 10,
        maxEnergy: gameState.maxEnergy || 10,
        currentState: gameState.currentState || 'default',
        airJumpsLeft: gameState.airJumpsLeft ?? 1,
        hasShield: gameState.hasShield || false,
        isPhasing: gameState.isPhasing || false,
        isInvisible: gameState.isInvisible || false
    };
}

/**
 * Create world data from game state
 */
export function createWorldSaveData(
    timeOfDay: number,
    weather: {
        state: 'clear' | 'rain' | 'storm';
        intensity: number;
        stormCharge: number;
    },
    season: {
        season: string;
        progress: number;
        moonPhase: number;
    }
): WorldSaveData {
    return {
        timeOfDay,
        weatherState: weather.state,
        weatherIntensity: weather.intensity,
        stormCharge: weather.stormCharge,
        season: season.season,
        seasonProgress: season.progress,
        moonPhase: season.moonPhase
    };
}

/**
 * Create progress data from game state
 */
export function createProgressSaveData(
    discoveries: string[],
    inventory: Record<string, number>,
    milestones: string[],
    unlocks: string[],
    playtime: number
): ProgressSaveData {
    return {
        discoveredEntities: discoveries,
        collectionCounts: { ...inventory },
        milestones,
        unlocks,
        inventory,
        playtime
    };
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const saveSystem = new SaveSystem();

// =============================================================================
// DEBUG COMMANDS (Exposed to window)
// =============================================================================

declare global {
    interface Window {
        saveGame: (slotId?: string) => Promise<boolean>;
        loadGame: (slotId: string) => Promise<SaveData | null>;
        exportSave: (slotId?: string) => Promise<string | null>;
        importSave: (json: string, slotId?: string) => Promise<boolean>;
        deleteSave: (slotId: string) => Promise<boolean>;
        listSaves: () => Promise<SaveSlotInfo[]>;
        resetAllData: () => Promise<boolean>;
    }
}

// Expose debug commands
if (typeof window !== 'undefined') {
    window.saveGame = (slotId?: string) => {
        const id = slotId || 'debug-save';
        console.log(`[Debug] Saving game to slot: ${id}`);
        return saveSystem.save(id, 'Debug Save');
    };

    window.loadGame = (slotId: string) => {
        console.log(`[Debug] Loading game from slot: ${slotId}`);
        return saveSystem.load(slotId);
    };

    window.exportSave = (slotId?: string) => {
        const id = slotId || saveSystem.getCurrentSlotId() || 'auto-0';
        console.log(`[Debug] Exporting save: ${id}`);
        return saveSystem.exportSave(id);
    };

    window.importSave = (json: string, slotId?: string) => {
        console.log('[Debug] Importing save');
        return saveSystem.importSave(json, slotId);
    };

    window.deleteSave = (slotId: string) => {
        console.log(`[Debug] Deleting save: ${slotId}`);
        return saveSystem.deleteSlot(slotId);
    };

    window.listSaves = () => {
        console.log('[Debug] Listing all saves');
        return saveSystem.listSlots();
    };

    window.resetAllData = () => {
        console.log('[Debug] Resetting all data');
        if (confirm('Are you sure you want to delete ALL save data? This cannot be undone.')) {
            return saveSystem.deleteAllData();
        }
        return Promise.resolve(false);
    };
}

// Re-export types
export type {
    MigrationFunction
};

// Default export
export default saveSystem;
