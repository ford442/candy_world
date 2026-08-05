import { CONFIG } from './defaults.ts';
import { isCIorHeadless } from './runtime.ts';
import { _hasFlag, _getFlag } from './url-flags.ts';

// ---------------------------------------------------------------------------
// Post-FX resolution helpers — read URL overrides on top of CONFIG.postfx.
// Defined after CONFIG so they can reference it; only ever called at runtime.
// ---------------------------------------------------------------------------

/** Effective post-FX quality tier (URL ?postfx= wins over CONFIG default). */
export function resolvePostfxQuality(): 'off' | 'low' | 'high' {
    const q = _getFlag('postfx');
    if (q === 'off' || q === 'low' || q === 'high') return q;
    return CONFIG.postfx.quality;
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
 * Disabled on CI/headless, postfx=off, or CONFIG.lighting.shadows.enabled=false.
 */
export function resolveShadowSettings(): ShadowSettings {
    const cfg = CONFIG.lighting.shadows;
    if (!cfg.enabled || cfg.forceDisable || isCIorHeadless()) {
        return { enabled: false, mapSize: 0 };
    }

    const quality = resolvePostfxQuality();
    if (quality === 'off') {
        return { enabled: false, mapSize: 0 };
    }
    if (quality === 'low' && cfg.disableOnLowPostfx) {
        return { enabled: false, mapSize: 0 };
    }

    const mapSize = quality === 'high' ? cfg.mapSizeHigh : cfg.mapSize;
    return { enabled: true, mapSize };
}
