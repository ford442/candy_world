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
    /**
     * Cascade count for CSM, or 0 when cascades are off (legacy single follow map).
     * Always 0 when `enabled` is false.
     */
    cascades: number;
}

/** Clamp a configured cascade count into the supported 2–4 range. */
export function clampCascadeCount(count: number): number {
    if (!Number.isFinite(count)) return 2;
    return Math.max(2, Math.min(4, Math.round(count)));
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
        return { enabled: false, mapSize: 0, cascades: 0 };
    }

    // ?postfx=off remains a hard debug escape for shadows too.
    if (_getFlag('postfx') === 'off') {
        return { enabled: false, mapSize: 0, cascades: 0 };
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
        return { enabled: false, mapSize: 0, cascades: 0 };
    }
    if (resolution === 'low' && cfg.disableOnLowPostfx) {
        return { enabled: false, mapSize: 0, cascades: 0 };
    }

    const mapSize = resolution === 'high' ? cfg.mapSizeHigh : cfg.mapSize;
    const cascades = cfg.cascadesEnabled
        ? clampCascadeCount(resolution === 'high' ? cfg.cascadeCountHigh : cfg.cascadeCount)
        : 0;

    return { enabled: true, mapSize, cascades };
}

// ---------------------------------------------------------------------------
// Lightweight GI (irradiance probe volume) — see docs/IRRADIANCE_PROBES.md
// ---------------------------------------------------------------------------

export interface GiSettings {
    enabled: boolean;
    /** Probe counts per axis. 0 on every axis when `enabled` is false. */
    gridX: number;
    gridY: number;
    gridZ: number;
    /** World units between probes. */
    cellSize: number;
    /** Bake budget per frame, nearest-to-camera first. */
    probesPerFrame: number;
}

const GI_OFF: GiSettings = {
    enabled: false,
    gridX: 0,
    gridY: 0,
    gridZ: 0,
    cellSize: 0,
    probesPerFrame: 0,
};

/**
 * Probe-volume density for this session.
 *
 * Off on the `low` graphics tier (WebGL and CI/headless both clamp to `low`),
 * off for `?gi=off` / `?postfx=off`, low-res on `medium`, denser on `high`.
 * Like `resolveShadowSettings()` this reads `StartupCapabilities`, never the
 * raw persisted profile.
 */
export function resolveGiSettings(): GiSettings {
    const cfg = CONFIG.lighting.gi;
    // CONFIG is the only switch no URL flag can talk out of.
    if (!cfg.enabled || cfg.forceDisable) return GI_OFF;

    const flag = _getFlag('gi');
    if (flag === 'off') return GI_OFF;

    // QA escape hatch: ?gi=on / ?gi=high / ?gi=debug force the volume on so the
    // bounce can be inspected on a headless capture or a low-tier machine,
    // where it would otherwise be skipped.
    const forced = flag === 'on' || flag === 'high' || flag === 'debug';

    if (!forced) {
        if (isCIorHeadless()) return GI_OFF;
        if (_getFlag('postfx') === 'off') return GI_OFF;
    }

    let graphics: 'low' | 'medium' | 'high';
    try {
        graphics = getStartupCapabilities().graphics;
    } catch {
        // Pre-boot / non-browser: infer from the post-FX tier.
        const q = resolvePostfxQuality();
        graphics = q === 'off' ? 'low' : q === 'high' ? 'high' : 'medium';
    }

    if (!forced && cfg.disableOnLow && graphics === 'low') return GI_OFF;

    const high = flag === 'high' || (graphics === 'high' && flag !== 'on');
    return {
        enabled: true,
        gridX: clampGridAxis(high ? cfg.gridXHigh : cfg.gridX),
        gridY: clampGridAxis(high ? cfg.gridYHigh : cfg.gridY),
        gridZ: clampGridAxis(high ? cfg.gridZHigh : cfg.gridZ),
        cellSize: Math.max(1, high ? cfg.cellSizeHigh : cfg.cellSize),
        probesPerFrame: Math.max(1, Math.round(high ? cfg.probesPerFrameHigh : cfg.probesPerFrame)),
    };
}

/** Keep a probe axis in the 2–32 band: below 2 there is nothing to interpolate. */
export function clampGridAxis(count: number): number {
    if (!Number.isFinite(count)) return 2;
    return Math.max(2, Math.min(32, Math.round(count)));
}
