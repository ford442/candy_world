/**
 * Candy World configuration — split modules re-exported for stable import path.
 * @see ../config.ts barrel
 */

export { hasUrlFlag, getUrlFlag, _hasFlag, _getFlag, FEATURE_FLAGS } from './url-flags.ts';

export {
    isCIorHeadless,
    getDeviceMemoryGB,
    getJsHeapUsageRatio,
    getLoadMemoryTier,
    getLoadMemoryScale,
    shouldPreferLightWorldLoad,
    setGpuPrefersLightWorldLoad,
    getCIAdjustedCount,
    type LoadMemoryTier,
} from './runtime.ts';

export {
    DURATION_SUNRISE,
    DURATION_DAY,
    DURATION_SUNSET,
    DURATION_DUSK_NIGHT,
    DURATION_DEEP_NIGHT,
    DURATION_PRE_DAWN,
    CYCLE_DURATION,
} from './cycle.ts';

export {
    PALETTE,
    type PaletteEntry,
    type EntityScaleRange,
    type EntityScaleEntry,
} from './palette.ts';

export { AUDIO_DEFAULTS } from './audio.ts';
export { FAUNA_DEFAULTS } from './fauna.ts';
export { GROUND_DEFAULTS, PLAYER_DEFAULTS } from './ground.ts';
export { PRESENCE_DEFAULTS } from './presence.ts';

export { type ConfigType } from './types.ts';
export { CONFIG } from './defaults.ts';

export {
    resolvePostfxQuality,
    areGodRaysEnabled,
    isDofEnabled,
    isDofManual,
    resolveShadowSettings,
    clampSoftness,
    softnessToRadius,
    shadowKernelForResolution,
    shadowFilterTapCount,
    type ShadowSettings,
    type ShadowKernel,
} from './postfx.ts';
