/**
 * What this device and page load can do, resolved once at boot.
 *
 * `initPlatformCapabilities()` runs in `initScene()` as soon as the renderer
 * backend is known, freezes the result, and publishes it as
 * `window.__platformCapabilities`. Before that, `getPlatformCapabilities()`
 * returns an uncached provisional resolution (backend inferred), so early
 * callers still get a sane answer.
 *
 * Inputs are device signals (adapter, granted features, `deviceMemory`,
 * `(dynamic-range: high)`), the run mode, and the `?graphics=` override —
 * never the user-agent string. Graphics *decisions* (warmup, post-FX, shadow
 * tables) stay in `core/startup/capabilities.ts`; this module answers the
 * device questions those and the per-frame paths ask.
 */

// Leaf module: imports nothing outside core/platform/ (vite.config.js gives the
// folder its own chunk so `weather` can call it while `app` is still evaluating).
import { getRunMode, type RunMode } from './run-mode.ts';

export type PlatformBackend = 'webgpu' | 'webgl2';
export type PlatformTier = 'low' | 'medium' | 'high';
export type CanvasColorSpace = 'srgb' | 'display-p3';

export interface HdrSupport {
    /** `(dynamic-range: high)` matched. Informational; it does not pick the canvas space. */
    readonly display: boolean;
    /** Swap chain is float16 with `toneMapping: { mode: 'extended' }`. */
    readonly extendedRange: boolean;
    /** Canvas / `renderer.outputColorSpace`. P3 only with real extended range. */
    readonly canvas: CanvasColorSpace;
}

export interface PlatformCapabilities {
    readonly runMode: RunMode;
    readonly backend: PlatformBackend;
    readonly tier: PlatformTier;
    /** GPU compute dispatch is worth issuing (WebGPU backend, real player). */
    readonly computeAvailable: boolean;
    readonly timestampQuery: boolean;
    readonly hdr: Readonly<HdrSupport>;
    readonly maxPixelRatio: number;
}

export interface PlatformCapabilityInputs {
    runMode: RunMode;
    backend: PlatformBackend;
    fallbackAdapter: boolean;
    /** Adapter looks integrated / software / low storage (`setGpuPrefersLightWorldLoad`). */
    gpuPrefersLite: boolean;
    deviceMemoryGB: number | undefined;
    timestampQuery: boolean;
    displayHdr: boolean;
    extendedRange: boolean;
    /** `?graphics=` / `?gfx=` value, if any. */
    graphicsOverride: string | null;
}

/**
 * Whether the swap chain is configured for extended range. Three 0.171's
 * WebGPUBackend configures `getPreferredCanvasFormat()` (8-bit) with no
 * `toneMapping`, so it is not, and the canvas stays sRGB on HDR displays too.
 * Flip only together with a float16 + `toneMapping: { mode: 'extended' }`
 * configure; `init.ts` then registers Display P3 and drops ACES.
 */
export const EXTENDED_RANGE_CONFIGURED = false;

/**
 * `pixelRatio` cap per tier: `low` renders one pixel per CSS pixel, `medium`
 * 1.25, `high` 1.5. Chrome reports at most 8 GB of `deviceMemory`, so most
 * Chrome players are `medium`; on a 2× display that is 1.56× the pixels of
 * 1.0 instead of the 2.25× the old flat 1.5 cap drew. The dynamic-resolution
 * controller (`rendering/dynamic-resolution.ts`) scales the scene pass below
 * this cap; it never raises it.
 */
export const MAX_PIXEL_RATIO: Readonly<Record<PlatformTier, number>> = Object.freeze({
    low: 1,
    medium: 1.25,
    high: 1.5,
});

/** Pure: the cap for a tier/backend. WebGL2 is always 1, whatever `?graphics=` says. */
export function resolveMaxPixelRatio(tier: PlatformTier, backend: PlatformBackend): number {
    return backend === 'webgl2' ? 1 : MAX_PIXEL_RATIO[tier];
}

/**
 * Approximate device RAM in GB via `navigator.deviceMemory` (Chrome/Edge).
 * Returns `undefined` when the API is unavailable (Firefox, Safari, etc.).
 */
export function getDeviceMemoryGB(): number | undefined {
    if (typeof navigator === 'undefined') return undefined;
    const gb = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
    return typeof gb === 'number' && gb > 0 ? gb : undefined;
}

export function resolveHdrSupport(displayHdr: boolean, extendedRange: boolean): HdrSupport {
    return {
        display: displayHdr,
        extendedRange: displayHdr && extendedRange,
        canvas: displayHdr && extendedRange ? 'display-p3' : 'srgb',
    };
}

export function detectDisplayHdr(): boolean {
    try {
        return (
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(dynamic-range: high)').matches
        );
    } catch {
        return false;
    }
}

function tierFromOverride(value: string | null): PlatformTier | null {
    if (value === 'low' || value === 'medium' || value === 'high') return value;
    if (value === 'ultra') return 'high';
    return null;
}

/** Pure — the only place the platform tier is decided. */
export function resolvePlatformCapabilities(input: PlatformCapabilityInputs): PlatformCapabilities {
    const automation = input.runMode === 'automation';

    let tier: PlatformTier;
    const override = tierFromOverride(input.graphicsOverride);
    if (override) {
        tier = override;
    } else if (automation || input.backend === 'webgl2' || input.fallbackAdapter) {
        tier = 'low';
    } else if (typeof input.deviceMemoryGB === 'number' && input.deviceMemoryGB <= 4) {
        tier = 'low';
    } else if (
        input.gpuPrefersLite ||
        (typeof input.deviceMemoryGB === 'number' && input.deviceMemoryGB <= 8)
    ) {
        tier = 'medium';
    } else {
        tier = 'high';
    }

    const hdr = resolveHdrSupport(
        input.displayHdr,
        input.extendedRange && input.backend === 'webgpu'
    );

    return Object.freeze({
        runMode: input.runMode,
        backend: input.backend,
        tier,
        computeAvailable: input.backend === 'webgpu' && !automation,
        timestampQuery: input.backend === 'webgpu' && input.timestampQuery,
        hdr: Object.freeze(hdr),
        maxPixelRatio: resolveMaxPixelRatio(tier, input.backend),
    });
}

function readGraphicsOverride(): string | null {
    try {
        const params = new URLSearchParams(window.location.search);
        return params.get('graphics') ?? params.get('gfx');
    } catch {
        return null;
    }
}

function inferBackend(): PlatformBackend {
    try {
        if (typeof window !== 'undefined' && (window as { usingWebGL?: boolean }).usingWebGL) {
            return 'webgl2';
        }
    } catch {
        /* non-browser */
    }
    return 'webgpu';
}

export function gatherPlatformCapabilityInputs(
    known: Partial<PlatformCapabilityInputs> = {}
): PlatformCapabilityInputs {
    return {
        runMode: getRunMode(),
        backend: inferBackend(),
        fallbackAdapter: false,
        // Known only after armGpuContext(); init.ts passes it in.
        gpuPrefersLite: false,
        deviceMemoryGB: getDeviceMemoryGB(),
        timestampQuery: false,
        displayHdr: detectDisplayHdr(),
        extendedRange: EXTENDED_RANGE_CONFIGURED,
        graphicsOverride: readGraphicsOverride(),
        ...known,
    };
}

let cached: PlatformCapabilities | null = null;

/** Resolve, freeze and publish. Called once from `initScene()` after the backend is known. */
export function initPlatformCapabilities(
    known: Partial<PlatformCapabilityInputs> = {}
): PlatformCapabilities {
    cached = resolvePlatformCapabilities(gatherPlatformCapabilityInputs(known));
    try {
        if (typeof window !== 'undefined') {
            (window as { __platformCapabilities?: PlatformCapabilities }).__platformCapabilities =
                cached;
        }
    } catch {
        /* non-browser */
    }
    return cached;
}

export function getPlatformCapabilities(): PlatformCapabilities {
    return cached ?? resolvePlatformCapabilities(gatherPlatformCapabilityInputs());
}

/** @internal tests */
export function __resetPlatformCapabilitiesForTests(): void {
    cached = null;
}
