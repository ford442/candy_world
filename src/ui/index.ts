/**
 * UI Module - Candy World
 * 
 * Exports all UI components and utilities.
 */

// Loading Screen
export type { LoadingScreenOptions, LoadingPhase, LoadingProgress };
export {
    LoadingScreen,



    DEFAULT_LOADING_PHASES,
    initLoadingScreen,
    getLoadingScreen,
    showLoadingScreen,
    hideLoadingScreen,
    updateProgress,
    setLoadingStatus,
    completePhase,
    setLoadingDebug,
    installLegacyAPI
} from './loading-screen';

// Save Menu
export type { MenuTab, MenuMode, SaveMenuOptions };
export {
    SaveMenu,



    openSaveMenu,
    openLoadMenu,
    openSaveGameMenu,
    closeSaveMenu,
    isSaveMenuOpen,
    showSaveIndicator
} from './save-menu';

// Analytics Debug Overlay
export {
    analyticsDebug,
    toggleAnalyticsDebug,
    showAnalyticsDebug,
    hideAnalyticsDebug,
    registerStatsCommand
} from './analytics-debug';

// Re-export as default
export { default } from './loading-screen';
