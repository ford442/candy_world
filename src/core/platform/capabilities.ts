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
 * `(dynamic-range: high)`, the swap chain the probe configured), the run mode, and the `?graphics=` override —
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

/**
 * Device features requested only when the adapter advertises them; none is
 * ever required (`gpu-context.ts` `selectRequiredFeatures`). Systems branch on
 * `getPlatformCapabilities().gpu.has(name)` once, at init, never per frame.
 * The table of what each one is for is in docs/WEBGPU_CONTEXT.md#optional-features.
 */
export const GPU_OPTIONAL_FEATURES = [
    'timestamp-query',
    'shader-f16',
    'float32-filterable',
    'subgroups',
    'indirect-first-instance',
    'rg11b10ufloat-renderable',
] as const;

export type GpuOptionalFeature = (typeof GPU_OPTIONAL_FEATURES)[number];

export function isGpuOptionalFeature(name: string): name is GpuOptionalFeature {
    return (GPU_OPTIONAL_FEATURES as readonly string[]).includes(name);
}

/** The optional features the device was granted. Always empty on WebGL2. */
export interface GpuFeatureSet {
    readonly features: readonly GpuOptionalFeature[];
    has(name: GpuOptionalFeature): boolean;
}

export interface PlatformCapabilities {
    readonly runMode: RunMode;
    readonly backend: PlatformBackend;
    readonly tier: PlatformTier;
    /** GPU compute dispatch is worth issuing (WebGPU backend, real player). */
    readonly computeAvailable: boolean;
    readonly timestampQuery: boolean;
    readonly gpu: GpuFeatureSet;
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
    /** `device.features` as granted (any names; only the optional tiers are kept). */
    gpuFeatures?: readonly string[];
    displayHdr: boolean;
    /** The probe configured `rgba16float` + `toneMapping: { mode: 'extended' }`. */
    extendedRange: boolean;
    /** `?graphics=` / `?gfx=` value, if any. */
    graphicsOverride: string | null;
}

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

/** Pure: the granted optional features, frozen, with a `has()` lookup. */
export function resolveGpuFeatureSet(
    backend: PlatformBackend,
    granted: readonly string[] | undefined
): GpuFeatureSet {
    const features =
        backend === 'webgpu'
            ? GPU_OPTIONAL_FEATURES.filter((name) => granted?.includes(name) ?? false)
            : [];
    const set = new Set<GpuOptionalFeature>(features);
    return Object.freeze({
        features: Object.freeze(features),
        has: (name: GpuOptionalFeature) => set.has(name),
    });
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
        gpu: resolveGpuFeatureSet(input.backend, input.gpuFeatures),
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
        gpuFeatures: [],
        displayHdr: detectDisplayHdr(),
        // Known only after the probe configured the swap chain; init.ts passes it in.
        extendedRange: false,
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
