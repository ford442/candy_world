/**
 * Candy World configuration — split modules re-exported for stable import path.
 * @see ../config.ts barrel
 */

export {
    hasUrlFlag,
    getUrlFlag,
    _hasFlag,
    _getFlag,
    FEATURE_FLAGS,
} from './url-flags.ts';

export {
    isCIorHeadless,
    getDeviceMemoryGB,
    getJsHeapUsageRatio,
    getLoadMemoryTier,
    getLoadMemoryScale,
    shouldPreferLightWorldLoad,
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

export { type ConfigType } from './types.ts';
export { CONFIG } from './defaults.ts';

export {
    resolvePostfxQuality,
    areGodRaysEnabled,
    isDofEnabled,
    isDofManual,
    resolveShadowSettings,
    type ShadowSettings,
} from './postfx.ts';
