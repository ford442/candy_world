/**
 * Save Menu Module
 * 
 * Barrel file exporting all save menu components.
 */

// Main class and functions
export { 
    SaveMenu,
    openSaveMenu,
    openLoadMenu,
    openSaveGameMenu,
    closeSaveMenu,
    isSaveMenuOpen,
    showSaveIndicator
} from './save-menu.js';

// Types
export type { 
    MenuTab, 
    MenuMode, 
    SaveMenuOptions 
} from './save-menu.js';

// Styles
export { MENU_STYLES } from './save-menu-styles.js';

// Slot functions
export {
    renderSlot,
    renderLoadTab,
    renderSaveTab,
    formatPlaytime,
    handleSlotAction,
    handleQuickSave
} from './save-slots.js';

// Settings functions
export {
    renderSettingsTab,
    handleSettingChange,
    handleSettingClick,
    handleKeybindClick,
    cancelKeybindListen,
    updateKeybind,
    formatKey,
    formatKeybindAction
} from './save-settings.js';

// Default export
export { SaveMenu as default } from './save-menu.js';
