/**
 * UI Module - Candy World
 * 
 * Exports all UI components and utilities.
 */

// Loading Screen
export type { LoadingScreenOptions, LoadingPhase, LoadingProgress } from './loading-screen';
export {
    LoadingScreen,



    DEFAULT_LOADING_PHASES,
    initLoadingScreen,
    getLoadingScreen,
    showLoadingScreen,
    showDeferredIndicator,
    hideDeferredIndicator,
    setDeferredProgress,
    hideLoadingScreen,
    updateProgress,
    setLoadingStatus,
    completePhase,
    setLoadingDebug,
    setWasmPhase,
    setWasmError,
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
