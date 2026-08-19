import { getStartupCapabilities, type ShadowResolution } from '../startup/capabilities.ts';
import { CONFIG } from './defaults.ts';
import { isCIorHeadless } from './runtime.ts';
import { _hasFlag, _getFlag } from './url-flags.ts';

// ---------------------------------------------------------------------------
// Post-FX resolution helpers — URL ?postfx= wins, then StartupCapabilities,
// then CONFIG.postfx.quality. Never read raw profile.graphics here.
// ---------------------------------------------------------------------------

/** Effective post-FX quality tier (URL ?postfx= wins over capabilities). */
export function resolvePostfxQuality(): 'off' | 'low' | 'high' {
    const q = _getFlag('postfx');
    if (q === 'off' || q === 'low' || q === 'high') return q;
    try {
        return getStartupCapabilities().postfx.quality;
    } catch {
        return CONFIG.postfx.quality;
    }
}

/** Whether sunrise/sunset/moon god-ray shafts should render this session. */
export function areGodRaysEnabled(): boolean {
    if (resolvePostfxQuality() === 'off') return false;
    return CONFIG.postfx.godRays;
}

/**
 * Whether the Depth-of-Field bokeh pass should be built into the pipeline.
 * ?no_dof force-off wins; ?dof force-on next; otherwise the 'high' tier or the
 * CONFIG.postfx.dofEnabled flag enables it.
 */
export function isDofEnabled(): boolean {
    if (_hasFlag('no_dof')) return false;
    if (_hasFlag('dof')) return true;
    return resolvePostfxQuality() === 'high' || CONFIG.postfx.dofEnabled;
}

/**
 * Manual (always-on) DoF — not gated by flora proximity. True when force-enabled
 * via ?dof or CONFIG.postfx.dofEnabled; the 'high' tier alone stays proximity-driven.
 */
export function isDofManual(): boolean {
    if (_hasFlag('no_dof')) return false;
    return _hasFlag('dof') || CONFIG.postfx.dofEnabled;
}

export interface ShadowSettings {
    enabled: boolean;
    mapSize: number;
}

/**
 * Whether directional sun shadows are active and at what map resolution.
 *
 * The shadow tier comes from `StartupCapabilities.shadows` — the single source
 * of truth — not from the post-FX tier. CONFIG force-disable and CI/headless
 * remain hard escapes on top of it.
 */
export function resolveShadowSettings(): ShadowSettings {
    const cfg = CONFIG.lighting.shadows;
    if (!cfg.enabled || cfg.forceDisable || isCIorHeadless()) {
        return { enabled: false, mapSize: 0 };
    }

    // ?postfx=off remains a hard debug escape for shadows too.
    if (_getFlag('postfx') === 'off') {
        return { enabled: false, mapSize: 0 };
    }

    let resolution: ShadowResolution;
    try {
        const caps = getStartupCapabilities().shadows;
        resolution = caps.enabled ? caps.resolution : 'off';
    } catch {
        // Pre-boot / non-browser: fall back to the post-FX tier.
        const q = resolvePostfxQuality();
        resolution = q === 'off' ? 'off' : q === 'high' ? 'high' : 'low';
    }

    if (resolution === 'off') {
        return { enabled: false, mapSize: 0 };
    }
    if (resolution === 'low' && cfg.disableOnLowPostfx) {
        return { enabled: false, mapSize: 0 };
    }

    return { enabled: true, mapSize: resolution === 'high' ? cfg.mapSizeHigh : cfg.mapSize };
}
