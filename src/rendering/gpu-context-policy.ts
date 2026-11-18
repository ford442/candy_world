/**
 * @file gpu-context-policy.ts
 * @description The pure WebGPU request policy: what `gpu-context.ts` asks the
 * adapter for and how it configures the canvas.
 *
 * Nothing here touches `navigator.gpu`, creates a device, or holds state. It
 * answers "given this adapter / display / URL, what do we request?" so the
 * answer can be tested as a table. `gpu-context.ts` stays the **sole owner**
 * of `requestAdapter()` / `requestDevice()`, device adoption, diagnostics and
 * recovery, and re-exports everything below, so existing imports keep working.
 *
 * Decisions encoded here are deliberate and not tuned by this module's
 * existence: one device shared with Three.js, adapter-clamped limits (spec
 * floor on software adapters), optional `timestamp-query`, explicit canvas
 * alpha / color space, and canvas MSAA only when the post stack is bypassed.
 *
 * @see docs/WEBGPU_CONTEXT.md
 */

import {
    detectDisplayHdr,
    GPU_OPTIONAL_FEATURES,
    resolveHdrSupport,
    type GpuOptionalFeature,
} from '../core/platform/capabilities.ts';
import { readHdrPreference } from '../core/platform/hdr-preference.ts';

// =============================================================================
// POWER PREFERENCE
// =============================================================================

/**
 * Power preference requested for the one device.
 *
 * `high-performance` asks the browser for the discrete GPU on dual-GPU
 * laptops. The old compute/particle devices already requested it; the main
 * renderer did not, so on a hybrid laptop the renderer could land on the iGPU
 * while compute landed on the dGPU — two devices, two heaps, cross-adapter
 * copies. Requesting it on the single owned device removes that split.
 */
export const GPU_POWER_PREFERENCE: GPUPowerPreference = 'high-performance';

// =============================================================================
// LIMITS
// =============================================================================

/** Identifying strings an adapter reports (all best-effort, possibly empty). */
export interface GpuAdapterInfo {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
}

/**
 * Floor limits: exactly the WebGPU spec **defaults**, guaranteed by any
 * conformant adapter (including SwiftShader). This is what software/fallback
 * adapters are asked for, and what consumers assume before a device exists:
 *
 * - `maxStorageBufferBindingSize` 128 MiB — matches what
 *   `gpu-compute-library.ts` and `compute-particles.ts` used to request from
 *   their own devices, so no binding that used to fit can shrink.
 * - `maxComputeWorkgroupSizeX` / `maxComputeInvocationsPerWorkgroup` 256 —
 *   the workgroup size declared by the particle and culling WGSL kernels.
 * - `maxComputeWorkgroupStorageSize` 16 KiB — headroom for tiled kernels.
 * - `maxBufferSize` 256 MiB — a storage binding can never exceed its buffer.
 *
 * Read what was actually granted from `getGpuContextSync().limits`
 * (or `window.webgpuProbe.limitRequest`) rather than assuming these values.
 */
export const GPU_REQUIRED_LIMITS: Record<string, number> = {
    maxBufferSize: 268435456,
    maxStorageBufferBindingSize: 134217728,
    maxComputeWorkgroupSizeX: 256,
    maxComputeInvocationsPerWorkgroup: 256,
    maxComputeWorkgroupStorageSize: 16384,
};

/**
 * Soft ceilings asked of a hardware adapter. Each key is requested as
 * `min(adapter.limits[k], GPU_DESIRED_LIMITS[k])` (never below the floor), so
 * `requestDevice` cannot be rejected for asking more than the adapter has, and
 * we stop *hoping* the UA grants more than the spec default.
 *
 * Only the storage/buffer ceilings rise above the floor: bigger particle and
 * culling buffers are the only consumer that benefits today. Workgroup limits
 * stay at 256 because that is what the WGSL kernels declare.
 */
export const GPU_DESIRED_LIMITS: Record<string, number> = {
    maxBufferSize: 536870912,
    maxStorageBufferBindingSize: 536870912,
    maxComputeWorkgroupSizeX: 256,
    maxComputeInvocationsPerWorkgroup: 256,
    maxComputeWorkgroupStorageSize: 16384,
};

/** Software rasterisers and fallback adapters only ever get the spec floor. */
export function isSoftwareAdapter(adapter: GPUAdapter, info: GpuAdapterInfo | null): boolean {
    if ((adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter) return true;
    const blob = [info?.vendor, info?.architecture, info?.device, info?.description]
        .join(' ')
        .toLowerCase();
    return /swiftshader|llvmpipe|lavapipe|microsoft basic|warp/.test(blob);
}

/**
 * Adapter-aware `requiredLimits`: `min(adapter, desired)` per key on hardware
 * adapters, the spec floor on software/fallback adapters (SwiftShader CI), and
 * never above what the adapter advertises. The storage binding is also capped
 * at the requested `maxBufferSize`, since a binding cannot outgrow its buffer.
 */
export function resolveRequiredLimits(
    adapter: GPUAdapter,
    info: GpuAdapterInfo | null
): Record<string, number> {
    const supported = (adapter as GPUAdapter & { limits?: GPUSupportedLimits }).limits;
    const software = isSoftwareAdapter(adapter, info);
    const out: Record<string, number> = {};

    for (const key of Object.keys(GPU_REQUIRED_LIMITS)) {
        const floor = GPU_REQUIRED_LIMITS[key];
        const advertised = (supported as unknown as Record<string, unknown> | undefined)?.[key];
        const target = software ? floor : Math.max(floor, GPU_DESIRED_LIMITS[key] ?? floor);
        // An adapter that does not report the key gets the floor (spec-guaranteed);
        // one that reports less than the floor is non-conformant — never ask above it.
        out[key] = typeof advertised === 'number' ? Math.min(advertised, target) : floor;
    }

    if (out.maxStorageBufferBindingSize > out.maxBufferSize) {
        out.maxStorageBufferBindingSize = out.maxBufferSize;
    }
    return out;
}

// =============================================================================
// FEATURES
// =============================================================================

/** Nothing beyond the empty compute probe. Optional features are never required. */
export const GPU_REQUIRED_FEATURES: GPUFeatureName[] = [];

/**
 * Requested only when the adapter has them, never required: SwiftShader lacks
 * most of them, and a missing one only selects a slower path. The list lives
 * in `core/platform/capabilities.ts` (a leaf) so systems can name a feature in
 * `capabilities.gpu.has()` without importing this module.
 *
 * | Feature                    | Used for                                                     | Without it                          |
 * | -------------------------- | ------------------------------------------------------------ | ----------------------------------- |
 * | `timestamp-query`          | GPU frame time → dynamic resolution, performance budget       | no GPU time, fixed resolution       |
 * | `shader-f16`               | half-precision wind/sway and particle integrators (`enable f16;`) | f32                             |
 * | `float32-filterable`       | linear filtering of `r32float` / `rgba32float` (probe/LUT textures); Three switches those bindings to `float` | unfilterable-float, manual bilinear |
 * | `subgroups`                | subgroup prefix sum in the cull/compact pass; Three adds `enable subgroups;` to compute | workgroup shared-memory scan |
 * | `indirect-first-instance`  | one instance buffer shared by many indirect draws             | one buffer per draw                 |
 * | `rg11b10ufloat-renderable` | cheaper HDR scene target than `rgba16float`                  | `rgba16float`                       |
 */
export { GPU_OPTIONAL_FEATURES, type GpuOptionalFeature };

/**
 * GPU frame times feed dynamic resolution and the performance budget.
 * Request `timestamp-query` on every real boot when the adapter has it.
 * Chrome caps `deviceMemory` at 8 GB, so almost every player is the `medium`
 * tier — and that tier used to skip the feature, which left the scene pass
 * at full resolution while the GPU was over budget.
 * `?dynres=0` / `off` / `false` opts out. SwiftShader still lacks the feature;
 * `selectRequiredFeatures` only adds it when advertised.
 */
export function wantsTimestampQuery(): boolean {
    if (typeof window === 'undefined' || typeof window.location === 'undefined') return false;
    const location = window.location;
    try {
        const params = new URLSearchParams(location.search);
        const dynres = (params.get('dynres') || '').toLowerCase();
        return !(dynres === '0' || dynres === 'off' || dynres === 'false');
    } catch {
        return false;
    }
}

/**
 * The optional tiers other than timestamp-query are requested on every boot
 * the adapter offers them. `?gpuFeatures=off` (or `0` / `none`) asks for none
 * of them, to bisect a rendering difference down to a feature; timestamp-query
 * keeps its own switch (`?dynres=0`).
 */
export function wantsOptionalGpuFeatures(): boolean {
    if (typeof window === 'undefined' || typeof window.location === 'undefined') return true;
    try {
        const value = (new URLSearchParams(window.location.search).get('gpuFeatures') || '')
            .toLowerCase()
            .trim();
        return !(value === 'off' || value === '0' || value === 'none');
    } catch {
        return true;
    }
}

/**
 * Allowlist for requestDevice. Junk adapter features stay out; each optional
 * feature is included only when wanted and advertised, in list order.
 */
export function selectRequiredFeatures(
    adapter: GPUAdapter,
    opts: { timestampQuery?: boolean; optional?: boolean } = {}
): GPUFeatureName[] {
    const supported = adapter.features;
    const has = (name: GPUFeatureName) => Boolean(supported?.has?.(name));
    const out: GPUFeatureName[] = [];
    for (const name of GPU_REQUIRED_FEATURES) {
        if (has(name)) out.push(name);
    }
    const wantTimestamp = opts.timestampQuery ?? wantsTimestampQuery();
    const wantOptional = opts.optional ?? wantsOptionalGpuFeatures();
    for (const name of GPU_OPTIONAL_FEATURES) {
        const wanted = name === 'timestamp-query' ? wantTimestamp : wantOptional;
        if (wanted && has(name) && !out.includes(name)) out.push(name);
    }
    return out;
}

// =============================================================================
// CANVAS
// =============================================================================

/**
 * Swap-chain configuration. SDR: the preferred 8-bit format, `standard`. HDR:
 * `rgba16float`, `extended`, Display P3. The post chain's own render targets
 * are `rgba16float` either way.
 */
export interface GpuCanvasConfig {
    format: GPUTextureFormat;
    alphaMode: GPUCanvasAlphaMode;
    colorSpace: PredefinedColorSpace;
    toneMapping: GPUCanvasToneMappingMode;
    usage: number;
}

/** What the probe decided about extended-range output, and why. */
export interface GpuHdrReport {
    /** `(dynamic-range: high)` matched. */
    display: boolean;
    /** The player's mode (`auto` / `off`). */
    preference: 'auto' | 'off';
    /** An extended-range configure was attempted. */
    attempted: boolean;
    /** The swap chain is extended range (what `getConfiguration()` reported). */
    configured: boolean;
    /** Why it is not, when it is not. */
    reason: string | null;
}

/** Swap-chain format of the extended-range (HDR) configure. */
export const HDR_CANVAS_FORMAT: GPUTextureFormat = 'rgba16float';

/**
 * Alpha mode for the canvas context.
 *
 * Three maps `alpha: true` → `alphaMode: 'premultiplied'`, which is also its
 * default. The HUD, loading screen, badges, and accessibility menu are plain
 * DOM stacked over the canvas and rely on premultiplied compositing, so this
 * pins today's behaviour explicitly instead of inheriting it.
 */
export const GPU_ALPHA = true;

/**
 * MSAA samples for the post-FX scene pass, the `rgba16float` target the world
 * is drawn into. Passed to `pass()` explicitly; Three forces 0 on WebGL2.
 */
export const SCENE_PASS_SAMPLES = 4;

/**
 * Hardware MSAA on the canvas (swap chain).
 *
 * Three 0.171 sizes the canvas buffer from `renderer.samples` (4 whenever
 * `antialias` is set), and `PassNode` copied the same value into the scene
 * pass, so MSAA was paid twice: once on the scene pass, where it antialiases
 * the world, and again on the canvas, where the only draw is the fullscreen
 * post quad, which MSAA cannot improve. With the post graph running the canvas
 * is created without it and the scene pass asks for {@link SCENE_PASS_SAMPLES}
 * itself. `?postfx=off` draws the world straight to the canvas, so it keeps
 * the renderer's MSAA.
 */
export function resolveCanvasAntialias(postStackBypassed: boolean): boolean {
    return postStackBypassed;
}

/**
 * Canvas color space for the swap chain, chosen once at probe time.
 *
 * `display-p3` only when the display is HDR **and** the swap chain really is
 * configured for extended range (`extendedRange`, what the probe verified);
 * `srgb` otherwise, including on HDR displays with an SDR swap chain (#1972).
 * `init.ts` sets `renderer.outputColorSpace` from the probe result and
 * registers Display P3 with Three before selecting it, so the swap-chain tag
 * and Three's output transform always agree.
 */
export function resolveCanvasColorSpace(extendedRange = false): PredefinedColorSpace {
    return resolveHdrSupport(detectDisplayHdr(), extendedRange).canvas;
}

/**
 * Whether to try an extended-range swap chain, and why not when not: the
 * display reports `(dynamic-range: high)` and the player has not turned HDR
 * off (`candy.hdr` / `?hdr=off`, see `core/platform/hdr-preference.ts`).
 * The returned report is the probe's starting point; the probe fills in
 * `attempted` / `configured` / `reason` as it tries.
 */
export function resolveHdrIntent(): { wanted: boolean; report: GpuHdrReport } {
    const display = detectDisplayHdr();
    const preference = readHdrPreference().mode;
    const wanted = display && preference !== 'off';
    return {
        wanted,
        report: {
            display,
            preference,
            attempted: false,
            configured: false,
            reason: !display
                ? 'display is not (dynamic-range: high)'
                : preference === 'off'
                  ? 'HDR turned off (candy.hdr / ?hdr=off)'
                  : null,
        },
    };
}

export function wantsExtendedRange(): boolean {
    return resolveHdrIntent().wanted;
}

/**
 * The swap-chain configuration for one attempt. `extended` selects the HDR
 * variant (`rgba16float` + extended tone mapping + Display P3); otherwise the
 * adapter's preferred 8-bit format with standard tone mapping.
 */
export function resolveCanvasConfig(opts: {
    preferredFormat: GPUTextureFormat;
    usage: number;
    extended: boolean;
}): GpuCanvasConfig {
    return {
        format: opts.extended ? HDR_CANVAS_FORMAT : opts.preferredFormat,
        usage: opts.usage,
        alphaMode: GPU_ALPHA ? 'premultiplied' : 'opaque',
        colorSpace: resolveCanvasColorSpace(opts.extended),
        toneMapping: opts.extended ? 'extended' : 'standard',
    };
}

/** The `GPUCanvasConfiguration` for `context.configure()`. */
export function toConfiguration(
    device: GPUDevice,
    config: GpuCanvasConfig
): GPUCanvasConfiguration {
    return {
        device,
        format: config.format,
        usage: config.usage,
        alphaMode: config.alphaMode,
        colorSpace: config.colorSpace,
        toneMapping: { mode: config.toneMapping },
    };
}
