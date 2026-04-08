/**
 * Save System Types - Type definitions and constants for the save system
 */

// =============================================================================
// CONSTANTS & CONFIG
// =============================================================================

export const SAVE_VERSION = '1.0.0';
export const DB_NAME = 'CandyWorldSaveDB';
export const DB_VERSION = 1;
export const STORE_NAME = 'saves';

export const AUTO_SAVE_INTERVAL = 30000; // 30 seconds
export const AUTO_SAVE_SLOTS = 3;
export const MANUAL_SAVE_SLOTS = 5;

export const LOCALSTORAGE_KEY_SETTINGS = 'candy_world_settings';
export const LOCALSTORAGE_KEY_METADATA = 'candy_world_save_metadata';

// Compression constants
export const COMPRESSION_THRESHOLD = 1024; // Bytes below which we don't compress

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
 * Session metadata for tracking
 */
export interface SessionMetadata {
    sessionStartTime: number;
    lastSaveTime: number;
    currentSlotId: string | null;
}

/**
 * Unlock save data
 */
export interface UnlockSaveData {
    unlocks: string[];
    discoveredEntities: string[];
    milestones: string[];
}

/**
 * Migration function type
 */
export type MigrationFunction = (data: any, fromVersion: string) => any;
