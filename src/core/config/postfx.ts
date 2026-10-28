import { isAutomation } from '../platform/run-mode.ts';
import { getStartupCapabilities, type ShadowResolution } from '../startup/capabilities.ts';
import { CONFIG } from './defaults.ts';
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

/**
 * `?postfx=off`: draw the world straight to the canvas with `renderer.render()`
 * and build no post graph at all (no scene pass, bloom or composite).
 *
 * Only the URL flag does this. The `low` graphics tier, WebGL2 and automation
 * also resolve the post-FX *quality* to `'off'`, but that means "no optional
 * effects" (DoF, GTAO, god rays): they keep bloom and the colour grade.
 */
export function isPostStackBypassed(): boolean {
    return _getFlag('postfx') === 'off';
}

export type AntialiasMode = 'off' | 'msaa' | 'fxaa' | 'smaa' | 'traa';

function isAntialiasMode(value: string | null): value is AntialiasMode {
    return (
        value === 'off' ||
        value === 'msaa' ||
        value === 'fxaa' ||
        value === 'smaa' ||
        value === 'traa'
    );
}

/**
 * How the post graph antialiases the world. `?aa=off|msaa|fxaa|smaa|traa` wins.
 *
 * - WebGL2 and the `low` tier: FXAA on the tone-mapped image. Their scene pass
 *   has no MSAA (the GLSL backend never had it, and a 4× `rgba16float` buffer
 *   is the low tier's biggest one), so before this they had no geometric AA.
 * - `medium` / `high`: 4× MSAA on the scene pass, except with GTAO (`high`'s
 *   default), which gets SMAA: GTAO gathers the scene pass's depth, and WGSL
 *   has no `textureGather` for the 4× pass's `texture_depth_multisampled_2d`,
 *   so its shader fails to compile. That holds for `?aa=msaa` too.
 * - TRAA is opt-in: the velocity buffer it reprojects with does not see the
 *   foliage's vertex-shader sway, so it needs a check on real hardware before
 *   it can be anyone's default.
 */
export function resolveAntialiasMode(
    backend: 'webgpu' | 'webgl',
    aoEnabled = false
): AntialiasMode {
    const mode = pickAntialiasMode(backend);
    return mode === 'msaa' && aoEnabled ? 'smaa' : mode;
}

function pickAntialiasMode(backend: 'webgpu' | 'webgl'): AntialiasMode {
    const flag = _getFlag('aa');
    if (isAntialiasMode(flag)) return flag;
    if (backend === 'webgl') return 'fxaa';
    let graphics: 'low' | 'medium' | 'high' = 'medium';
    try {
        graphics = getStartupCapabilities().graphics;
    } catch {
        /* capabilities not resolved yet (tests): medium */
    }
    return graphics === 'low' ? 'fxaa' : 'msaa';
}

/**
 * Dynamic resolution on the scene pass (rendering/dynamic-resolution.ts). It
 * needs GPU frame times, so it runs where `timestamp-query` was requested
 * (`?debug`, `?graphics=high`, or `?dynres=1`, which also requests it) and
 * granted. `?dynres=0|off` turns it off; automation never runs it.
 */
export function isDynamicResolutionAllowed(): boolean {
    const flag = _getFlag('dynres');
    if (flag === '0' || flag === 'off') return false;
    return !isAutomation();
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

/**
 * WebGPU GTAO. Off on `low` / `off` / CI unless `?ao`. `?no_ao` always wins.
 * The WebGL2 fallback never builds this pass (`initPostProcessing` gates it on the backend).
 */
export function isAoEnabled(): boolean {
    if (_hasFlag('no_ao')) return false;
    const aoFlag = _getFlag('ao');
    if (aoFlag === 'off' || aoFlag === '0') return false;
    const forcedOn = _hasFlag('ao') || aoFlag === '1' || aoFlag === 'on' || aoFlag === '';
    if (!forcedOn && isAutomation()) return false;
    if (forcedOn) return true;
    if (CONFIG.postfx.aoEnabled) return true;
    return resolvePostfxQuality() === 'high';
}

/** TSL PCF kernel width. 1 = hard compare; 3 = default; 5 = high-tier. */
export type ShadowKernel = 1 | 3 | 5;

export interface ShadowSettings {
    enabled: boolean;
    mapSize: number;
    /**
     * Cascade count for CSM, or 0 when cascades are off (legacy single follow map).
     * Always 0 when `enabled` is false.
     */
    cascades: number;
    /** PCF kernel. Boot-time — changing it recodes the shadow filter. */
    kernel: ShadowKernel;
    /** Artist softness 0–1. Live via `shadow.radius`. */
    softness: number;
    /** Texel radius derived from softness × `pcfRadius`. */
    radius: number;
    /** Cheap PCSS-style contact term. High tier only. */
    pcssEnabled: boolean;
    /** 0–1 light size mixed into the contact term. 0 disables it without recoding. */
    pcssLightSize: number;
}

const SHADOW_OFF: ShadowSettings = {
    enabled: false,
    mapSize: 0,
    cascades: 0,
    kernel: 1,
    softness: 0,
    radius: 0,
    pcssEnabled: false,
    pcssLightSize: 0,
};

/** Clamp artist softness into 0–1. */
export function clampSoftness(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

/**
 * Map 0–1 softness onto a texel radius. 0 stays just under a texel (hard contact);
 * 1 hits `pcfRadius`.
 */
export function softnessToRadius(softness: number, pcfRadius: number): number {
    const s = clampSoftness(softness);
    const maxR = Number.isFinite(pcfRadius) && pcfRadius > 0 ? pcfRadius : 4;
    const minR = 0.25;
    return minR + (maxR - minR) * s;
}

/** Kernel for a shadow-resolution tier. `low` graphics already turns shadows off. */
export function shadowKernelForResolution(resolution: ShadowResolution): ShadowKernel {
    if (resolution === 'high') return 5;
    if (resolution === 'low') return 3;
    return 1;
}

/**
 * Hardware compare taps per fragment per cascade. The 3×3 / 5×5 kernels always
 * include a 4-tap edge ring so `pcssLightSize` can be live-toggled.
 */
export function shadowFilterTapCount(kernel: ShadowKernel): number {
    if (kernel <= 1) return 1;
    return kernel * kernel + 4;
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
    if (!cfg.enabled || cfg.forceDisable || isAutomation()) {
        return { ...SHADOW_OFF };
    }

    // ?postfx=off remains a hard debug escape for shadows too.
    if (_getFlag('postfx') === 'off') {
        return { ...SHADOW_OFF };
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
        return { ...SHADOW_OFF };
    }
    if (resolution === 'low' && cfg.disableOnLowPostfx) {
        return { ...SHADOW_OFF };
    }

    const mapSize = resolution === 'high' ? cfg.mapSizeHigh : cfg.mapSize;
    const cascades = cfg.cascadesEnabled
        ? clampCascadeCount(resolution === 'high' ? cfg.cascadeCountHigh : cfg.cascadeCount)
        : 0;

    const softnessFlag = _getFlag('shadowSoft');
    const softnessParsed = softnessFlag !== null ? Number.parseFloat(softnessFlag) : Number.NaN;
    const softness = clampSoftness(Number.isFinite(softnessParsed) ? softnessParsed : cfg.softness);

    const pcssFlag = _getFlag('pcss');
    const pcssForcedOn = pcssFlag === '1' || pcssFlag === 'on' || pcssFlag === '';
    const pcssForcedOff = pcssFlag === '0' || pcssFlag === 'off';
    const pcssEnabled =
        resolution === 'high' && !pcssForcedOff && (cfg.pcssEnabled || pcssForcedOn);

    return {
        enabled: true,
        mapSize,
        cascades,
        kernel: shadowKernelForResolution(resolution),
        softness,
        radius: softnessToRadius(softness, cfg.pcfRadius),
        pcssEnabled,
        pcssLightSize: pcssEnabled ? clampSoftness(cfg.pcssLightSize) : 0,
    };
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
        if (isAutomation()) return GI_OFF;
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
