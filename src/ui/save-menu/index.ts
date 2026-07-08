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
} from './save-menu.ts';

// Types
export type { 
    MenuTab, 
    MenuMode, 
    SaveMenuOptions 
} from './save-menu.ts';

// Styles
export { MENU_STYLES } from './save-menu-styles.ts';

// Slot functions
export {
    renderSlot,
    renderLoadTab,
    renderSaveTab,
    formatPlaytime,
    handleSlotAction,
    handleQuickSave
} from './save-slots.ts';

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
} from './save-settings.ts';

// Default export
export { SaveMenu as default } from './save-menu.ts';
