/**
 * UI Module - Candy World
 *
 * Boot-critical exports only (loading screen). Heavy panels (save-menu,
 * analytics-debug) are lazy-loaded via their own entry points (#1361).
 */

// Loading Screen
export type { LoadingScreenOptions, LoadingPhase, LoadingProgress } from './loading-screen.ts';
export {
    LoadingScreen,
    DEFAULT_LOADING_PHASES,
    initLoadingScreen,
    getLoadingScreen,
    showLoadingScreen,
    showDeferredIndicator,
    hideDeferredIndicator,
    setDeferredProgress,
    setDeferredFailures,
    hideLoadingScreen,
    updateProgress,
    setLoadingStatus,
    completePhase,
    setLoadingDebug,
    setWasmPhase,
    setWasmError,
    installLegacyAPI
} from './loading-screen.ts';

// Re-export as default
export { default } from './loading-screen.ts';
