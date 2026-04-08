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

import { showToast } from '../../utils/toast.js';
import {
    SAVE_VERSION,
    SAVE_VERSION as SAVE_VERSION_CONST,
    AUTO_SAVE_INTERVAL,
    AUTO_SAVE_SLOTS,
    MANUAL_SAVE_SLOTS,
    LOCALSTORAGE_KEY_SETTINGS,
    LOCALSTORAGE_KEY_METADATA,
    SaveData,
    PlayerSaveData,
    WorldSaveData,
    ProgressSaveData,
    SettingsSaveData,
    SaveSlotInfo,
    SaveMetadata
} from './save-types.js';
import { SaveDatabase, MigrationSystem, LZString } from './save-database.js';

// =============================================================================
// MAIN SAVE SYSTEM
// =============================================================================

export class SaveSystem {
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

    // -------------------------------------------------------------------------
    // AUTO-SAVE SYSTEM
    // -------------------------------------------------------------------------

    /**
     * Quick save to rotating auto-save slot
     */
    async autoSave(): Promise<boolean> {
        const slotIndex = Math.floor(Date.now() / AUTO_SAVE_INTERVAL) % AUTO_SAVE_SLOTS;
        const slotId = `auto-${slotIndex}`;
        return this.save(slotId, `Auto Save ${slotIndex + 1}`);
    }

    /**
     * Start auto-save interval
     */
    startAutoSave(): void {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }
        this.autoSaveTimer = window.setInterval(() => {
            this.autoSave();
        }, AUTO_SAVE_INTERVAL);
    }

    /**
     * Stop auto-save interval
     */
    stopAutoSave(): void {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }

    /**
     * Set auto-save interval (in milliseconds)
     */
    setAutoSaveInterval(intervalMs: number): void {
        this.stopAutoSave();
        if (intervalMs > 0) {
            this.autoSaveTimer = window.setInterval(() => {
                this.autoSave();
            }, intervalMs);
        }
    }

    // -------------------------------------------------------------------------
    // SLOT MANAGEMENT
    // -------------------------------------------------------------------------

    /**
     * Get list of all save slots
     */
    async getSaveSlots(): Promise<SaveSlotInfo[]> {
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
     * Load from a specific slot (alias for load)
     */
    async loadSlot(slotId: string): Promise<SaveData | null> {
        return this.load(slotId);
    }

    /**
     * Save to a specific slot
     */
    async saveToSlot(slotId: string, slotName?: string): Promise<boolean> {
        const exists = await this.db.load(slotId);
        const name = slotName || (exists ? exists.metadata.slotName : `Save ${slotId}`);
        const result = await this.save(slotId, name);
        if (result) {
            showToast(`Game saved: ${name}`, '💾', 3000);
        }
        return result;
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
     * Export save to file (download)
     */
    async exportToFile(slotId?: string): Promise<boolean> {
        const id = slotId || this.currentSlotId || 'auto-0';
        const data = await this.exportSave(id);
        if (!data) return false;

        try {
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `candy-world-save-${id}-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Save exported to file', '📤', 3000);
            return true;
        } catch (e) {
            console.error('[SaveSystem] Export to file failed:', e);
            return false;
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
     * Import save from file
     */
    async importFromFile(file: File, targetSlotId?: string): Promise<boolean> {
        try {
            const text = await file.text();
            return await this.importSave(text, targetSlotId);
        } catch (e) {
            console.error('[SaveSystem] Import from file failed:', e);
            showToast('Import failed: Could not read file', '❌', 5000);
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

    /**
     * Get current settings
     */
    getSettings(): SettingsSaveData {
        return { ...this.settings };
    }

    /**
     * Update settings
     */
    updateSettings(newSettings: Partial<SettingsSaveData>): void {
        this.settings = { ...this.settings, ...newSettings };
        this.saveSettingsSync(this.settings);
    }

    /**
     * Sync settings to game
     */
    syncSettingsToGame(): void {
        // Apply settings to game systems
        // This would be implemented based on game integration
        console.log('[SaveSystem] Syncing settings to game:', this.settings);
    }

    /**
     * Sync settings from game
     */
    syncSettingsFromGame(gameSettings: Partial<SettingsSaveData>): void {
        this.settings = { ...this.settings, ...gameSettings };
        this.saveSettingsSync(this.settings);
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
            version: SAVE_VERSION_CONST,
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

    /**
     * Get current slot ID
     */
    getCurrentSlotId(): string | null {
        return this.currentSlotId;
    }

    /**
     * Get last save time
     */
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

    /**
     * Cleanup old saves
     */
    async cleanup(): Promise<void> {
        await this.db.cleanup(AUTO_SAVE_SLOTS);
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
        return saveSystem.getSaveSlots();
    };

    window.resetAllData = () => {
        console.log('[Debug] Resetting all data');
        if (confirm('Are you sure you want to delete ALL save data? This cannot be undone.')) {
            return saveSystem.deleteAllData();
        }
        return Promise.resolve(false);
    };
}

export default saveSystem;
