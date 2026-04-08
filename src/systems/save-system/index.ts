/**
 * Save System Barrel Export
 * 
 * Re-exports all save system types and classes for convenient importing.
 * Maintains backward compatibility with previous single-file structure.
 */

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type {
    SerializableVector3,
    PlayerSaveData,
    WorldSaveData,
    ProgressSaveData,
    KeyBindings,
    SettingsSaveData,
    SaveMetadata,
    SaveData,
    SaveSlotInfo,
    SessionMetadata,
    UnlockSaveData,
    MigrationFunction
} from './save-types.js';

// =============================================================================
// CONSTANT EXPORTS
// =============================================================================

export {
    SAVE_VERSION,
    DB_NAME,
    DB_VERSION,
    STORE_NAME,
    AUTO_SAVE_INTERVAL,
    AUTO_SAVE_SLOTS,
    MANUAL_SAVE_SLOTS,
    LOCALSTORAGE_KEY_SETTINGS,
    LOCALSTORAGE_KEY_METADATA,
    COMPRESSION_THRESHOLD
} from './save-types.js';

// =============================================================================
// DATABASE EXPORTS
// =============================================================================

export {
    LZString,
    SaveDatabase,
    MigrationSystem
} from './save-database.js';

// =============================================================================
// MAIN SAVE SYSTEM EXPORTS
// =============================================================================

export {
    SaveSystem,
    saveSystem,
    createPlayerSaveData,
    createWorldSaveData,
    createProgressSaveData
} from './save-system.js';

// =============================================================================
// DEFAULT EXPORT (Backward Compatibility)
// =============================================================================

export { saveSystem as default } from './save-system.js';
