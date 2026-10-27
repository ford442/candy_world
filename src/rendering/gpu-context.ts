/**
 * @file gpu-context.ts
 * @description Single owner of the WebGPU device for Candy World.
 *
 * Candy World creates exactly **one** `GPUDevice` per page load, and the
 * Three.js renderer owns it. Every other GPU consumer (compute library,
 * compute particles, profiling) borrows that device through this module
 * instead of calling `navigator.gpu.requestDevice()` again.
 *
 * Why: independent devices do not share VRAM budgets, buffers, or pipeline
 * caches. Three separate devices on an integrated GPU (or SwiftShader in CI)
 * multiplies allocation pressure and makes device-loss far likelier — and
 * when it happened there was no recovery path on the render side.
 *
 * This module is also the **only** caller of `requestAdapter` / `requestDevice`
 * in the app. `probeWebGPU()` brings the device up and hands it to Three via
 * `parameters.device`, so the renderer requests nothing of its own.
 *
 * Lifecycle:
 * ```
 *   init.ts  ──▶ probeWebGPU(canvas)           (adapter → device → configure → compute)
 *            ──▶ new WebGPURenderer({ device, context, ... })
 *            ──▶ armGpuContext(renderer, probe)
 *                    └─▶ await renderer.init()        (Three re-configures the canvas)
 *                    └─▶ assert the WebGPU backend won
 *                    └─▶ resolve getGpuContext()
 *            ──▶ renderer.outputColorSpace = probe.canvas.colorSpace
 *            ──▶ applyCanvasColorSpace(probe, …)   (Three's configure drops colorSpace)
 * ```
 *
 * A failed probe throws `WebGPUUnavailableError`. `init.ts` catches it and boots
 * Three's WebGL2 backend instead, then calls {@link settleWebGLContext} so the
 * context reports `backend: 'webgl'` and every compute consumer fails closed to
 * its CPU/WASM tier. Only when WebGL2 is unavailable too does boot stop at the
 * hard-fail screen.
 *
 * Consumers:
 * ```ts
 * const device = await awaitGpuDevice();
 * if (!device) return this.initCPUFallback();  // fail closed, never throw
 * ```
 *
 * @see docs/WEBGPU_CONTEXT.md
 */

import { setGpuPrefersLightWorldLoad } from '../core/config/runtime.ts';
import {
    detectDisplayHdr,
    EXTENDED_RANGE_CONFIGURED,
    resolveHdrSupport,
} from '../core/platform/capabilities.ts';
import { readUserAgent } from '../core/platform/user-agent.ts';
import type { RendererBackend } from './renderer-mode.ts';

// =============================================================================
// CONTEXT OPTIONS (the single source of truth for renderer construction)
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
 * Read what was actually granted from {@link getGpuContextSync}`().limits`
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

/** Per-key trace of the limit negotiation, mirrored onto `window.webgpuProbe`. */
export interface GpuLimitRequest {
    floor: number;
    desired: number;
    /** What the adapter advertises, or null when it does not report the key. */
    adapter: number | null;
    /** What `requestDevice` was asked for. */
    requested: number;
    /** What the device actually reports, or null before/without a device. */
    granted: number | null;
}

/** Software rasterisers and fallback adapters only ever get the spec floor. */
function isSoftwareAdapter(adapter: GPUAdapter, info: GpuAdapterInfo | null): boolean {
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

function describeLimitRequest(
    adapter: GPUAdapter | null,
    requested: Record<string, number>,
    granted: Record<string, number> | null
): Record<string, GpuLimitRequest> {
    const supported = adapter?.limits;
    const out: Record<string, GpuLimitRequest> = {};
    for (const key of Object.keys(requested)) {
        const advertised = (supported as unknown as Record<string, unknown> | undefined)?.[key];
        out[key] = {
            floor: GPU_REQUIRED_LIMITS[key],
            desired: GPU_DESIRED_LIMITS[key] ?? GPU_REQUIRED_LIMITS[key],
            adapter: typeof advertised === 'number' ? advertised : null,
            requested: requested[key],
            granted: granted?.[key] ?? null,
        };
    }
    return out;
}

/**
 * Canvas color space for the swap chain, chosen once at probe time.
 *
 * `display-p3` only when the display is HDR **and** the swap chain is really
 * configured for extended range ({@link EXTENDED_RANGE_CONFIGURED}); `srgb`
 * otherwise, including on HDR displays today (#1972). `init.ts` sets
 * `renderer.outputColorSpace` from the probe result and registers Display P3
 * with Three before selecting it, so the swap-chain tag and Three's output
 * transform always agree.
 */
export function resolveCanvasColorSpace(): PredefinedColorSpace {
    return resolveHdrSupport(detectDisplayHdr(), EXTENDED_RANGE_CONFIGURED).canvas;
}

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

let canvasAntialias = false;

/** Record what the renderer was created with, for `window.__gpuContext`. */
export function recordCanvasAntialias(antialias: boolean): void {
    canvasAntialias = antialias;
    publishGpuContext();
}

// =============================================================================
// TYPES
// =============================================================================

export interface GpuAdapterInfo {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
}

export interface GpuContext {
    /** Backend actually in use. */
    backend: RendererBackend;
    /** True when a usable WebGPU device is available for compute work. */
    available: boolean;
    /** The one owned device, or null before the probe / after device loss. */
    device: GPUDevice | null;
    /** The adapter the probe requested — the only one this page asks for. */
    adapter: GPUAdapter | null;
    /** Granted device limits (numeric subset of `GPUSupportedLimits`). */
    limits: Record<string, number> | null;
    adapterInfo: GpuAdapterInfo | null;
    powerPreference: GPUPowerPreference;
    /** Limits the device was requested with (adapter-clamped; floor before the probe). */
    requiredLimits: Record<string, number>;
    /** True once the device (WebGPU) or context (WebGL2) has been lost. Rendering has stopped. */
    lost: boolean;
    lostReason: string | null;
    /** Why WebGPU is unavailable, when it is. */
    reason: string | null;
}

type DeviceLostListener = (reason: string) => void;

/** One `uncapturederror` the device raised (validation, out-of-memory, internal). */
export interface GpuErrorRecord {
    type: 'validation' | 'out-of-memory' | 'internal' | 'unknown';
    message: string;
    /** `performance.now()` when it fired. */
    at: number;
}

// =============================================================================
// STATE
// =============================================================================

const UNAVAILABLE: GpuContext = {
    // `webgpu` + `available: false` means "not brought up (yet)". A WebGL2
    // fallback is recorded explicitly by `settleWebGLContext()`.
    backend: 'webgpu',
    available: false,
    device: null,
    adapter: null,
    limits: null,
    adapterInfo: null,
    powerPreference: GPU_POWER_PREFERENCE,
    requiredLimits: GPU_REQUIRED_LIMITS,
    lost: false,
    lostReason: null,
    reason: 'not-initialized',
};

let context: GpuContext = { ...UNAVAILABLE };
let contextPromise: Promise<GpuContext> | null = null;
let resolveContext: ((ctx: GpuContext) => void) | null = null;
let armed = false;

const deviceLostListeners = new Set<DeviceLostListener>();

/** How many uncaptured errors to keep, and how many to echo to the console. */
const GPU_ERROR_HISTORY = 20;
const GPU_ERROR_CONSOLE_LIMIT = 3;
let gpuErrorCount = 0;
let gpuErrors: GpuErrorRecord[] = [];
/** WebGL2 only: the browser handed the context back after a loss. */
let contextRestored = false;

/** Result of the one boot probe, reused by `armGpuContext`. */
let probePromise: Promise<GpuProbeResult> | null = null;
let probeReport: GpuProbeReport | null = null;

function ensurePromise(): Promise<GpuContext> {
    if (!contextPromise) {
        contextPromise = new Promise<GpuContext>((resolve) => {
            resolveContext = resolve;
        });
    }
    return contextPromise;
}

function applyGpuLoadHint(ctx: GpuContext): void {
    const storage = ctx.limits?.maxStorageBufferBindingSize ?? 0;
    const fallback = Boolean(
        (ctx.adapter as GPUAdapter & { isFallbackAdapter?: boolean })?.isFallbackAdapter
    );
    const blob = [
        ctx.adapterInfo?.vendor,
        ctx.adapterInfo?.architecture,
        ctx.adapterInfo?.device,
        ctx.adapterInfo?.description,
    ]
        .join(' ')
        .toLowerCase();
    const integrated = /intel|uhd|iris|mali|adreno|swiftshader|llvmpipe|microsoft basic/.test(blob);
    // Spec default is 128 MiB; discrete adapters usually grant more.
    const lowStorage = storage > 0 && storage <= GPU_REQUIRED_LIMITS.maxStorageBufferBindingSize;
    setGpuPrefersLightWorldLoad(fallback || integrated || lowStorage);
}

function settle(next: GpuContext): GpuContext {
    context = next;
    ensurePromise();
    if (resolveContext) {
        resolveContext(context);
        resolveContext = null;
    }
    applyGpuLoadHint(context);
    publishGpuContext();
    return context;
}

// =============================================================================
// BOOT PROBE
// =============================================================================

/**
 * Where the probe gave up. Mirrored onto `window.webgpuProbe.stage` so a bug
 * report says *which* WebGPU step died, not just "it didn't work".
 */
export type GpuProbeStage =
    | 'navigator'
    | 'adapter'
    | 'device'
    | 'canvas'
    | 'configure'
    | 'pipeline'
    | 'renderer'
    /** WebGPU failed *and* the WebGL2 fallback could not start either. */
    | 'webgl';

/**
 * WebGPU could not be brought up.
 *
 * `createRenderer()` catches this and falls back to WebGL2 — visibly, never
 * silently: a quiet GL render is what once hid the Chrome-vs-Edge adapter bug
 * this probe exists to expose, so the stage and reason are kept on
 * `window.webgpuProbe` and shown on the renderer badge. When WebGL2 is
 * unavailable as well, boot stops at the hard-fail screen.
 */
export class WebGPUUnavailableError extends Error {
    readonly stage: GpuProbeStage;
    readonly detail: unknown;

    constructor(stage: GpuProbeStage, message: string, detail?: unknown) {
        super(message);
        this.name = 'WebGPUUnavailableError';
        this.stage = stage;
        this.detail = detail;
    }
}

/** Everything the probe brings up, handed to Three so it requests nothing. */

/** Nothing beyond the empty compute probe. Optional features are never required. */
export const GPU_REQUIRED_FEATURES: GPUFeatureName[] = [];

/** Requested only when the adapter has them. Never required — SwiftShader lacks timestamp-query. */
export const GPU_OPTIONAL_FEATURES: GPUFeatureName[] = ['timestamp-query'];

export interface GpuFeatureReport {
    /** Adapter-advertised. Logging only — not passed to requestDevice. */
    adapter: GPUFeatureName[];
    /** Allowlist actually passed as requiredFeatures. */
    requested: GPUFeatureName[];
    /** device.features, or null before a device exists. */
    granted: GPUFeatureName[] | null;
    /** timestamp-query was wanted this boot and the device granted it. */
    timestampQuery: boolean;
}

/**
 * `?debug=1`, `?graphics=high` or `?dynres=1` (dynamic resolution needs GPU
 * frame times). Never throws; a bad location means "do not request".
 */
export function wantsTimestampQuery(): boolean {
    if (typeof window === 'undefined' || typeof window.location === 'undefined') return false;
    const location = window.location;
    try {
        const q = new URLSearchParams(location.search);
        if (q.get('debug') === '1' || q.has('debug')) return true;
        const dynres = q.get('dynres');
        if (dynres === '1' || dynres === 'on') return true;
        return (q.get('graphics') || q.get('quality') || '').toLowerCase() === 'high';
    } catch {
        return false;
    }
}

/**
 * Allowlist for requestDevice. Junk adapter features stay out.
 * timestamp-query is included only when wanted and advertised.
 */
export function selectRequiredFeatures(
    adapter: GPUAdapter,
    opts: { timestampQuery?: boolean } = {}
): GPUFeatureName[] {
    const supported = adapter.features;
    const has = (name: GPUFeatureName) => Boolean(supported?.has?.(name));
    const out: GPUFeatureName[] = [];
    for (const name of GPU_REQUIRED_FEATURES) {
        if (has(name)) out.push(name);
    }
    const wantTimestamp = opts.timestampQuery ?? wantsTimestampQuery();
    if (wantTimestamp && has('timestamp-query') && !out.includes('timestamp-query')) {
        out.push('timestamp-query');
    }
    return out;
}

function listFeatures(set: GPUSupportedFeatures | undefined): GPUFeatureName[] {
    if (!set) return [];
    const out: GPUFeatureName[] = [];
    // The DOM set iterates feature names as string, wider than the GPUFeatureName union.
    for (const name of set) out.push(name as GPUFeatureName);
    out.sort();
    return out;
}

function describeFeatures(
    adapter: GPUAdapter | null,
    requested: GPUFeatureName[],
    device: GPUDevice | null
): GpuFeatureReport {
    const granted = device ? listFeatures(device.features) : null;
    return {
        adapter: adapter ? listFeatures(adapter.features) : [],
        requested: [...requested].sort(),
        granted,
        timestampQuery: Boolean(granted?.includes('timestamp-query')),
    };
}

export interface GpuProbeResult {
    adapter: GPUAdapter;
    device: GPUDevice;
    context: GPUCanvasContext;
    adapterInfo: GpuAdapterInfo | null;
    /** The adapter-clamped `requiredLimits` the device was requested with. */
    requiredLimits: Record<string, number>;
    /** Swap-chain configuration (minus `device`), re-applied after Three's own configure. */
    canvas: GpuCanvasConfig;
    /** Allowlist that was requested, plus what the device actually granted. */
    features: GpuFeatureReport;
}

/** Swap-chain configuration. HDR render targets are separate (`rgba16float`). */
export interface GpuCanvasConfig {
    format: GPUTextureFormat;
    alphaMode: GPUCanvasAlphaMode;
    colorSpace: PredefinedColorSpace;
    usage: number;
}

/**
 * Browser identity, biased toward telling Edge apart from Chrome.
 *
 * Both send `Chrome/` in the UA string, and their WebGPU stacks diverge, so a
 * report that only says "Chromium" cannot distinguish the two failures.
 */
export interface BrowserBrand {
    name: string;
    version: string;
    /** Full UA-CH brand list when available — the reliable Edge/Chrome split. */
    brands: string[];
    userAgent: string;
    platform: string;
}

/** Probe outcome mirrored onto `window.webgpuProbe`, on success and failure. */
export interface GpuProbeReport {
    ok: boolean;
    stage: GpuProbeStage | 'ok';
    reason: string | null;
    browser: BrowserBrand;
    adapter: GpuAdapterInfo | null;
    adapterName: string;
    isFallbackAdapter: boolean;
    /** Adapter vs requested vs granted. Present on failure too (granted null if no device). */
    features: GpuFeatureReport;
    /** Granted device limits (all numeric keys), or null without a device. */
    limits: Record<string, number> | null;
    powerPreference: GPUPowerPreference;
    /** What `requestDevice` was actually asked for (adapter-clamped). */
    requiredLimits: Record<string, number>;
    /** Per-key floor / desired / adapter / requested / granted trace. */
    limitRequest: Record<string, GpuLimitRequest> | null;
    /** Swap-chain format / alphaMode / colorSpace, or null before configure. */
    canvas: Omit<GpuCanvasConfig, 'usage'> | null;
    timestamp: string;
}

function describeBrowser(): BrowserBrand {
    if (typeof navigator === 'undefined') {
        return { name: 'unknown', version: '', brands: [], userAgent: '', platform: '' };
    }

    const nav = navigator as Navigator & {
        userAgentData?: {
            brands?: { brand: string; version: string }[];
            platform?: string;
        };
    };
    const ua = readUserAgent();
    const brands = nav.userAgentData?.brands ?? [];
    const brandList = brands.map((b) => `${b.brand} ${b.version}`.trim());

    // UA-CH pads the list with "Chromium" and a deliberately absurd
    // "Not)A;Brand" entry; the real product is whatever is left.
    const real = brands.find(
        (b) => !/^not[^a-z]*a[^a-z]*brand$/i.test(b.brand) && !/^chromium$/i.test(b.brand)
    );
    if (real) {
        return {
            name: real.brand,
            version: real.version,
            brands: brandList,
            userAgent: ua,
            platform: nav.userAgentData?.platform ?? navigator.platform ?? '',
        };
    }

    // UA fallback. Order matters: Edge and Opera both also claim `Chrome/`.
    const patterns: [string, RegExp][] = [
        ['Microsoft Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/],
        ['Opera', /OPR\/([\d.]+)/],
        ['Chrome', /Chrome\/([\d.]+)/],
        ['Firefox', /Firefox\/([\d.]+)/],
        ['Safari', /Version\/([\d.]+).*Safari/],
    ];
    for (const [name, re] of patterns) {
        const m = ua.match(re);
        if (m) {
            return {
                name,
                version: m[1],
                brands: brandList,
                userAgent: ua,
                platform: navigator.platform ?? '',
            };
        }
    }

    return {
        name: 'unknown',
        version: '',
        brands: brandList,
        userAgent: ua,
        platform: navigator.platform ?? '',
    };
}

function publishProbeReport(report: GpuProbeReport): void {
    probeReport = report;
    if (typeof window !== 'undefined') window.webgpuProbe = { ...report };
}

/** Trivial kernel: proves the device can actually compile and lay out compute. */
const PROBE_SHADER = '@compute @workgroup_size(1) fn main() {}';

/**
 * Bring up WebGPU, or fail loudly.
 *
 * This is the **only** place in the app that calls `requestAdapter` /
 * `requestDevice`. It walks the full path the world needs — adapter, device,
 * canvas context, canvas configure, and an empty compute pipeline — so a
 * browser that hands out an adapter but cannot compile compute (or cannot
 * configure the swap chain) fails here, at boot, with a named stage, rather
 * than three seconds into world generation.
 *
 * The device it returns is handed to `WebGPURenderer` via `parameters.device`,
 * which is why probing costs no second device.
 *
 * @param canvas The real world canvas — probing a throwaway canvas would not
 *   exercise the swap-chain configure that actually breaks.
 * @throws {WebGPUUnavailableError} Always, when WebGPU is not usable.
 */
export function probeWebGPU(canvas: HTMLCanvasElement): Promise<GpuProbeResult> {
    if (!probePromise) probePromise = runProbe(canvas);
    return probePromise;
}

async function runProbe(canvas: HTMLCanvasElement): Promise<GpuProbeResult> {
    const browser = describeBrowser();
    let adapter: GPUAdapter | null = null;
    let adapterInfo: GpuAdapterInfo | null = null;
    let device: GPUDevice | null = null;
    let requiredLimits: Record<string, number> = GPU_REQUIRED_LIMITS;
    let requiredFeatures: GPUFeatureName[] = [];
    let canvasConfig: GpuCanvasConfig | null = null;

    const fail = (stage: GpuProbeStage, message: string, detail?: unknown): never => {
        publishProbeReport({
            ok: false,
            stage,
            reason: message,
            browser,
            adapter: adapterInfo,
            adapterName: describeAdapter(adapterInfo),
            isFallbackAdapter: Boolean(
                (adapter as GPUAdapter & { isFallbackAdapter?: boolean })?.isFallbackAdapter
            ),
            limits: device ? snapshotLimits(device.limits) : null,
            powerPreference: GPU_POWER_PREFERENCE,
            requiredLimits,
            limitRequest: adapter
                ? describeLimitRequest(
                      adapter,
                      requiredLimits,
                      device ? snapshotLimits(device.limits) : null
                  )
                : null,
            features: describeFeatures(adapter, requiredFeatures, device),
            canvas: canvasConfig ? publicCanvasConfig(canvasConfig) : null,
            timestamp: new Date().toISOString(),
        });
        // A half-built device would otherwise sit pinned until GC.
        try {
            device?.destroy();
        } catch {
            /* destroy is best-effort */
        }
        settle({ ...UNAVAILABLE, reason: `${stage}: ${message}` });
        // A warning, not an error: the caller falls back to WebGL2, and only
        // reports a fatal error when that fails too.
        console.warn(
            `[GPUContext] WebGPU probe failed at "${stage}" on ${browser.name} ${browser.version}: ${message}`
        );
        throw new WebGPUUnavailableError(stage, message, detail);
    };

    // 1 — navigator.gpu
    if (typeof navigator === 'undefined' || !navigator.gpu) {
        return fail(
            'navigator',
            'navigator.gpu is missing — this browser exposes no WebGPU implementation'
        );
    }

    // 2 — adapter. Returns null (not throws) when the GPU is blocklisted or
    // the browser has no usable backend; this is the Chrome/Edge split point.
    try {
        adapter = await navigator.gpu.requestAdapter({ powerPreference: GPU_POWER_PREFERENCE });
    } catch (err) {
        return fail('adapter', `requestAdapter() threw: ${describeError(err)}`, err);
    }
    if (!adapter) {
        return fail(
            'adapter',
            'requestAdapter() resolved null — no WebGPU adapter is available (GPU blocklisted, driver too old, or GPU access disabled)'
        );
    }
    adapterInfo = await readAdapterInfo(adapter, null);

    // 3 — device. An allowlist of features (selectRequiredFeatures), not
    // Array.from(adapter.features); timestamp-query is optional. Limits are
    // clamped to what this adapter advertises (spec floor on software
    // adapters), so the request can never be rejected for asking too much.
    requiredLimits = resolveRequiredLimits(adapter, adapterInfo);
    requiredFeatures = selectRequiredFeatures(adapter);
    try {
        device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
    } catch (err) {
        return fail('device', `requestDevice() rejected: ${describeError(err)}`, err);
    }
    if (!device) return fail('device', 'requestDevice() resolved without a device');
    adapterInfo = (await readAdapterInfo(adapter, device)) ?? adapterInfo;

    // 4 — canvas context
    let ctx: GPUCanvasContext | null = null;
    try {
        ctx = canvas.getContext('webgpu');
    } catch (err) {
        return fail('canvas', `canvas.getContext('webgpu') threw: ${describeError(err)}`, err);
    }
    if (!ctx) {
        return fail(
            'canvas',
            "canvas.getContext('webgpu') returned null — the canvas already holds a context of another type, or WebGPU canvas support is off"
        );
    }

    // 5 — configure the swap chain as Three will, plus the colorSpace Three
    // omits. The swap chain is 8-bit (`getPreferredCanvasFormat()`, usually
    // `bgra8unorm`); HDR lives in the `rgba16float` render targets upstream.
    canvasConfig = {
        format: navigator.gpu.getPreferredCanvasFormat(),
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        alphaMode: GPU_ALPHA ? 'premultiplied' : 'opaque',
        colorSpace: resolveCanvasColorSpace(),
    };
    try {
        ctx.configure({ device, ...canvasConfig });
    } catch (err) {
        return fail('configure', `context.configure() threw: ${describeError(err)}`, err);
    }

    // 6 — empty compute pipeline. Compute is not optional here: culling,
    // particles and the gpu-chores library all dispatch, and a device that
    // cannot compile WGSL compute is not a device we can ship the world on.
    try {
        device.pushErrorScope('validation');
        const module = device.createShaderModule({ code: PROBE_SHADER, label: 'webgpu-probe' });
        await device.createComputePipelineAsync({
            label: 'webgpu-probe-pipeline',
            layout: 'auto',
            compute: { module, entryPoint: 'main' },
        });
        const scoped = await device.popErrorScope();
        if (scoped)
            return fail(
                'pipeline',
                `compute pipeline validation failed: ${scoped.message}`,
                scoped
            );
    } catch (err) {
        // `fail()` throws, so a validation error caught here would otherwise be
        // reported (and the device destroyed) a second time.
        if (err instanceof WebGPUUnavailableError) throw err;
        return fail('pipeline', `compute pipeline creation failed: ${describeError(err)}`, err);
    }

    const features = describeFeatures(adapter, requiredFeatures, device);
    publishProbeReport({
        ok: true,
        stage: 'ok',
        reason: null,
        browser,
        adapter: adapterInfo,
        adapterName: describeAdapter(adapterInfo),
        isFallbackAdapter: Boolean(
            (adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter
        ),
        limits: snapshotLimits(device.limits),
        powerPreference: GPU_POWER_PREFERENCE,
        requiredLimits,
        limitRequest: describeLimitRequest(adapter, requiredLimits, snapshotLimits(device.limits)),
        features,
        canvas: publicCanvasConfig(canvasConfig),
        timestamp: new Date().toISOString(),
    });

    console.log(
        `[GPUContext] WebGPU probe passed on ${browser.name} ${browser.version} · adapter=${describeAdapter(adapterInfo)} · features=${features.granted?.join(',') || '(none)'}`
    );

    return {
        adapter,
        device,
        context: ctx,
        adapterInfo,
        requiredLimits,
        canvas: canvasConfig,
        features,
    };
}

function publicCanvasConfig(config: GpuCanvasConfig): Omit<GpuCanvasConfig, 'usage'> {
    return { format: config.format, alphaMode: config.alphaMode, colorSpace: config.colorSpace };
}

const pinnedColorSpace = new WeakMap<GPUCanvasContext, PredefinedColorSpace>();

/**
 * Three r186 configures the canvas lazily on the first frame, and again after
 * every resize (`updateSize()` drops its cached context), each time with only
 * device/format/usage/alphaMode/toneMapping, which resets `colorSpace` to
 * `srgb`. Keep the tag on the context instance so every later configure,
 * Three's included, carries it.
 */
function pinCanvasColorSpace(context: GPUCanvasContext, colorSpace: PredefinedColorSpace): void {
    const wrapped = pinnedColorSpace.has(context);
    pinnedColorSpace.set(context, colorSpace);
    if (wrapped) return;
    const configure = context.configure.bind(context);
    context.configure = (config: GPUCanvasConfiguration) =>
        configure({ ...config, colorSpace: pinnedColorSpace.get(context) ?? config.colorSpace });
}

/**
 * Re-apply the swap-chain configuration with `colorSpace`, and keep it there.
 *
 * Call this after {@link armGpuContext}, with the `outputColorSpace` the
 * renderer actually ended up on, so the canvas tag matches Three's output
 * transform through its own later configures ({@link pinCanvasColorSpace}).
 * Best-effort: a rejected configure keeps the previous swap chain.
 */
export function applyCanvasColorSpace(
    probe: GpuProbeResult,
    colorSpace: PredefinedColorSpace
): void {
    const next: GpuCanvasConfig = { ...probe.canvas, colorSpace };
    const previous = probe.canvas.colorSpace;
    try {
        pinCanvasColorSpace(probe.context, colorSpace);
        probe.context.configure({ device: probe.device, ...next });
        probe.canvas = next;
    } catch (err) {
        pinnedColorSpace.set(probe.context, previous);
        console.warn(
            `[GPUContext] Canvas configure with colorSpace=${colorSpace} failed: ${describeError(err)}`
        );
        return;
    }
    if (probeReport) publishProbeReport({ ...probeReport, canvas: publicCanvasConfig(next) });
}

function describeError(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
}

/** The last probe report, or null before the probe runs. */
export function getWebGPUProbeReport(): Readonly<GpuProbeReport> | null {
    return probeReport;
}

async function readAdapterInfo(
    adapter: GPUAdapter | null,
    device: GPUDevice | null
): Promise<GpuAdapterInfo | null> {
    // `GPUDevice.adapterInfo` (newer Chrome) → `GPUAdapter.info` → legacy
    // `requestAdapterInfo()`. All three are best-effort; a masked adapter
    // legitimately returns empty strings.
    const raw =
        (device as any)?.adapterInfo ??
        (adapter as any)?.info ??
        (typeof (adapter as any)?.requestAdapterInfo === 'function'
            ? await (adapter as any).requestAdapterInfo().catch(() => null)
            : null);

    if (!raw) return null;

    return {
        vendor: raw.vendor ?? '',
        architecture: raw.architecture ?? '',
        device: raw.device ?? '',
        description: raw.description ?? '',
    };
}

function snapshotLimits(limits: GPUSupportedLimits | undefined): Record<string, number> | null {
    if (!limits) return null;
    const out: Record<string, number> = {};
    for (const key in limits) {
        const value = (limits as any)[key];
        if (typeof value === 'number') out[key] = value;
    }
    return out;
}

// =============================================================================
// ARMING
// =============================================================================

/**
 * Adopt the probed device as the process-wide GPU context.
 *
 * Unlike the previous revision this **throws** rather than degrading. Three's
 * `WebGPURenderer` installs a `getFallback` that quietly swaps in `WebGLBackend`
 * when `WebGPUBackend.init()` fails (see `WebGPURenderer.js`), and the old code
 * merely noticed afterwards and booted the world on GL anyway. That silent
 * render is what hid the Chrome/Edge adapter failure, so any sign of the WebGL
 * backend is now a fatal boot error.
 *
 * @param renderer The renderer created by `init.ts`.
 * @param probe The result of {@link probeWebGPU}, whose device the renderer was
 *   constructed with.
 * @throws {WebGPUUnavailableError} When the renderer did not come up on WebGPU.
 */
export function timestampQueryGranted(probe: GpuProbeResult | null | undefined): boolean {
    return probe?.features?.timestampQuery === true;
}

export async function armGpuContext(renderer: unknown, probe: GpuProbeResult): Promise<GpuContext> {
    if (armed) return ensurePromise();
    armed = true;
    ensurePromise();

    const r = renderer as {
        isWebGPURenderer?: boolean;
        hasInitialized?: () => boolean;
        _initialized?: boolean;
        init?: () => Promise<void>;
        backend?: { isWebGLBackend?: boolean; isWebGPUBackend?: boolean; device?: GPUDevice };
    };

    const fatal = (message: string, detail?: unknown): never => {
        settle({ ...UNAVAILABLE, reason: `renderer: ${message}` });
        if (probeReport) {
            publishProbeReport({ ...probeReport, ok: false, stage: 'renderer', reason: message });
        }
        console.error(`[GPUContext] ${message}`);
        throw new WebGPUUnavailableError('renderer', message, detail);
    };

    if (!r?.isWebGPURenderer) {
        return fatal('Renderer is not a WebGPURenderer — cannot adopt the probed WebGPU device');
    }

    try {
        // `Renderer.init()` throws when called after it has already completed,
        // and shares its in-flight promise otherwise.
        if (typeof r.hasInitialized === 'function' ? !r.hasInitialized() : !r._initialized) {
            await r.init!();
        }
    } catch (err) {
        return fatal(`renderer.init() failed: ${describeError(err)}`, err);
    }

    const backend = r.backend;

    if (backend?.isWebGLBackend === true) {
        return fatal(
            'Three fell back to its WebGL2 backend after the WebGPU probe passed — ' +
                'refusing to render the world on WebGL'
        );
    }

    const device: GPUDevice | null = backend?.device ?? null;

    if (!device || !backend?.isWebGPUBackend) {
        return fatal('Renderer initialised without a WebGPU device');
    }

    if (device !== probe.device) {
        // The renderer was handed `probe.device`; a different one means Three
        // requested a second device behind our back, which breaks the
        // single-device invariant this module exists to hold.
        console.warn(
            '[GPUContext] Renderer is using a device other than the probed one — ' +
                'single-device invariant broken'
        );
    }

    const next: GpuContext = {
        backend: 'webgpu',
        available: true,
        device,
        adapter: probe.adapter,
        limits: snapshotLimits(device.limits),
        adapterInfo: probe.adapterInfo,
        powerPreference: GPU_POWER_PREFERENCE,
        requiredLimits: probe.requiredLimits,
        lost: false,
        lostReason: null,
        reason: null,
    };

    registerDeviceLost(device, r);
    registerUncapturedErrors(r);
    logGpuContext(next);
    return settle(next);
}

// =============================================================================
// DEVICE LOSS
// =============================================================================

type LossAwareRenderer = {
    onDeviceLost?: (info: { message?: string; reason?: string | null }) => void;
    _isDeviceLost?: boolean;
};

/**
 * Stop the renderer submitting work. `_isDeviceLost` is the flag Three's own
 * handler sets; `render()`, `compute()` and `compileAsync()` all honour it.
 */
function stopRenderer(renderer: unknown): void {
    if (!renderer || typeof renderer !== 'object') return;
    (renderer as LossAwareRenderer)._isDeviceLost = true;
}

/**
 * Replace Three's `onDeviceLost` (which logs a console error and sets
 * `_isDeviceLost`) with ours, which also stops the renderer (`stopRenderer`).
 */
function routeRendererLoss(renderer: unknown): void {
    if (!renderer || typeof renderer !== 'object') return;
    const r = renderer as LossAwareRenderer;
    r.onDeviceLost = (info) => {
        stopRenderer(r);
        handleGraphicsLost(info?.message || info?.reason || 'unknown reason');
    };
}

function registerDeviceLost(device: GPUDevice, renderer: unknown): void {
    // Every loss is treated as a fault, including `reason: 'destroyed'`:
    // nothing in the app destroys the shared device anymore (compute and
    // particles release their own buffers and leave the device alone), so a
    // destroy here means something external tore it down and the render path
    // is dead either way.
    device.lost
        .then((info: GPUDeviceLostInfo) => {
            stopRenderer(renderer);
            handleGraphicsLost(info?.message || info?.reason || 'unknown reason');
        })
        .catch(() => {
            /* `device.lost` never rejects; guard defensively anyway. */
        });

    // Route Three's own loss callback through the same handler so the render
    // path stops exactly once, however loss surfaces.
    routeRendererLoss(renderer);
}

function classifyGpuError(error: unknown): GpuErrorRecord['type'] {
    const name = (error as { constructor?: { name?: string } })?.constructor?.name ?? '';
    if (name === 'GPUValidationError') return 'validation';
    if (name === 'GPUOutOfMemoryError') return 'out-of-memory';
    if (name === 'GPUInternalError') return 'internal';
    return 'unknown';
}

/**
 * Record an uncaptured device error. Kept on `window.__gpuContext.errors` so a
 * bug report or the smoke test can see validation errors that would otherwise
 * live only in the browser console. Not cancelled: the browser still logs it.
 */
export function recordGpuError(error: unknown, at: number = performance.now()): GpuErrorRecord {
    const record: GpuErrorRecord = {
        type: classifyGpuError(error),
        message: String((error as { message?: unknown })?.message ?? error ?? 'unknown error'),
        at,
    };
    gpuErrorCount++;
    gpuErrors.push(record);
    if (gpuErrors.length > GPU_ERROR_HISTORY) gpuErrors = gpuErrors.slice(-GPU_ERROR_HISTORY);
    if (gpuErrorCount <= GPU_ERROR_CONSOLE_LIMIT) {
        console.warn(`[GPUContext] Uncaptured ${record.type} error: ${record.message}`);
    } else if (gpuErrorCount === GPU_ERROR_CONSOLE_LIMIT + 1) {
        console.warn(
            '[GPUContext] Further uncaptured errors are counted on window.__gpuContext.errors'
        );
    }
    publishGpuContext();
    return record;
}

/**
 * Three (r186) forwards `uncapturederror` to `renderer.onError`, whose default
 * is a `console.error` per event: a broken bind group would print one every
 * frame. Route it into `recordGpuError` (counted, console-capped) instead.
 */
function registerUncapturedErrors(renderer: unknown): void {
    if (!renderer || typeof renderer !== 'object') return;
    (renderer as { onError?: (info: ThreeErrorInfo) => void }).onError = (info) => {
        recordGpuError(info?.originalEvent?.error ?? info);
    };
}

interface ThreeErrorInfo {
    message?: string;
    originalEvent?: { error?: unknown };
}

/**
 * Watch the WebGL2 fallback canvas. Three's GLSL backend already cancels
 * `webglcontextlost` and calls `renderer.onDeviceLost`; without this the world
 * just went black. The browser may hand the context back
 * (`webglcontextrestored`), but Three 0.171 does not rebuild its GL objects,
 * so the banner stays and asks for a reload; the restore is only recorded.
 */
export function watchWebGLContextLoss(renderer: unknown, canvas: HTMLCanvasElement): void {
    routeRendererLoss(renderer);
    // Three's backend listener also calls `onDeviceLost`; this one keeps the
    // banner working if a Three upgrade stops doing that. Both are idempotent.
    canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        stopRenderer(renderer);
        handleGraphicsLost((event as WebGLContextEvent).statusMessage || 'context lost');
    });
    canvas.addEventListener('webglcontextrestored', () => {
        contextRestored = true;
        publishGpuContext();
        console.warn(
            '[GPUContext] WebGL2 context restored — reload needed to rebuild GPU resources'
        );
    });
}

function handleGraphicsLost(message: string): void {
    if (context.lost) return;

    const what = context.backend === 'webgl' ? 'WebGL2 context' : 'WebGPU device';
    context = { ...context, available: false, device: null, lost: true, lostReason: message };
    publishGpuContext();

    console.warn(`[GPUContext] ${what} lost: ${message} — rendering stopped`);

    for (const listener of deviceLostListeners) {
        try {
            listener(message);
        } catch (err) {
            console.warn('[GPUContext] Device-lost listener threw:', err);
        }
    }

    showGraphicsStoppedBanner(`${what} lost: ${message}`);
}

/**
 * Subscribe to device loss. Consumers use this to soft-disable GPU work and
 * swap to their CPU/WASM tier. Returns an unsubscribe function; fires
 * immediately if the device is already gone.
 */
export function onGpuDeviceLost(listener: DeviceLostListener): () => void {
    if (context.lost) {
        try {
            listener(context.lostReason ?? 'unknown reason');
        } catch {
            /* ignore */
        }
        return () => {};
    }
    deviceLostListeners.add(listener);
    return () => deviceLostListeners.delete(listener);
}

/** Banner text. Rendering has stopped on both backends; only a reload recovers. */
export const GRAPHICS_STOPPED_LABEL = 'Graphics stopped';

/**
 * Loss notice, styled after the existing renderer badge
 * (`src/ui/mode-badge.ts`) — a fixed pill, no modal, no input capture.
 */
function showGraphicsStoppedBanner(detail: string): void {
    if (typeof document === 'undefined' || !document.body) return;
    if (document.getElementById('gpu-device-lost-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'gpu-device-lost-banner';
    banner.setAttribute('role', 'alert');
    banner.title = detail;

    Object.assign(banner.style, {
        position: 'fixed',
        top: '52px',
        left: '12px',
        padding: '8px 12px',
        borderRadius: '14px',
        fontSize: '12px',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontWeight: '700',
        letterSpacing: '0.3px',
        zIndex: '10000',
        maxWidth: 'min(360px, calc(100vw - 24px))',
        background: 'rgba(255, 209, 220, 0.94)',
        color: '#3b1020',
        border: '1px solid rgba(255, 255, 255, 0.45)',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.12)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
    });

    const label = document.createElement('span');
    label.textContent = `${GRAPHICS_STOPPED_LABEL} —`;
    banner.appendChild(label);

    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload';
    Object.assign(reload.style, {
        font: 'inherit',
        cursor: 'pointer',
        padding: '4px 10px',
        borderRadius: '999px',
        border: '1px solid rgba(59, 16, 32, 0.35)',
        background: 'rgba(255, 255, 255, 0.7)',
        color: '#3b1020',
    });
    reload.addEventListener('click', () => window.location.reload());
    banner.appendChild(reload);

    document.body.appendChild(banner);
}

// =============================================================================
// ACCESSORS
// =============================================================================

/**
 * Await the shared GPU context. Resolves once the renderer has been armed, or
 * to an unavailable context when the boot probe failed.
 */
export function getGpuContext(): Promise<GpuContext> {
    return ensurePromise();
}

/** Current context without awaiting. Safe before arming (reports unavailable). */
export function getGpuContextSync(): GpuContext {
    return context;
}

/**
 * Record that the world is rendering on Three's WebGL2 backend.
 *
 * There is no `GPUDevice` on this path, so `available` stays false and every
 * `awaitGpuDevice()` caller fails closed to its CPU/WASM tier immediately. The
 * probe report keeps the WebGPU failure (stage + reason) that caused this.
 */
export function settleWebGLContext(reason: string): GpuContext {
    armed = true;
    return settle({ ...UNAVAILABLE, backend: 'webgl', reason });
}

/** True when the shared device exists and has not been lost. */
export function isGpuComputeAvailable(): boolean {
    return context.available && context.device !== null && !context.lost;
}

/**
 * Await the shared device, or `null` when GPU compute is unavailable.
 *
 * The timeout guards callers constructed outside the normal boot path (tests,
 * tools) where {@link armGpuContext} may never run: they fail closed to their
 * CPU tier rather than hanging forever.
 */
export async function awaitGpuDevice(timeoutMs = 10000): Promise<GPUDevice | null> {
    if (context.lost) return null;
    if (context.device) return context.device;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
            if (!armed) {
                console.warn('[GPUContext] No GPU context was armed — falling back to CPU tier');
            }
            resolve(null);
        }, timeoutMs);
    });

    try {
        const resolved = await Promise.race([ensurePromise(), timeout]);
        if (!resolved) return null;
        return resolved.lost ? null : resolved.device;
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

/**
 * Storage-buffer / workgroup ceilings of the shared device, falling back to
 * the requested floors before the device exists.
 */
export function getGpuLimit(name: string): number {
    return context.limits?.[name] ?? GPU_REQUIRED_LIMITS[name] ?? 0;
}

// =============================================================================
// BOOT LOG
// =============================================================================

declare global {
    interface Window {
        __gpuContext?: Record<string, unknown>;
        webgpuProbe?: Record<string, unknown>;
    }
}

/** Mirror the context onto `window.__gpuContext` for tests and the debug panel. */
export function publishGpuContext(): void {
    if (typeof window === 'undefined') return;

    // `window.webgpuProbe` belongs to the probe (it holds the browser brand and
    // the failing stage). Only fold in a *later* fault — device loss — so a
    // successful probe report is never overwritten by a thinner one.
    if (probeReport && context.lost) {
        window.webgpuProbe = {
            ...probeReport,
            ok: false,
            stage: 'renderer',
            reason: `device-lost: ${context.lostReason ?? 'unknown reason'}`,
        };
    } else if (probeReport) {
        window.webgpuProbe = { ...probeReport };
    }

    window.__gpuContext = {
        backend: context.backend,
        available: context.available,
        lost: context.lost,
        lostReason: context.lostReason,
        reason: context.reason,
        powerPreference: context.powerPreference,
        requiredLimits: context.requiredLimits,
        adapter: context.adapterInfo,
        adapterName: describeAdapter(context.adapterInfo),
        limits: context.limits,
        alpha: GPU_ALPHA,
        antialias: canvasAntialias,
        contextRestored,
        errors: { count: gpuErrorCount, recent: gpuErrors.slice() },
    };
}

function describeAdapter(info: GpuAdapterInfo | null): string {
    if (!info) return 'unknown';
    const parts = [info.vendor, info.architecture, info.device, info.description]
        .map((p) => p?.trim())
        .filter((p): p is string => !!p);
    return parts.length ? parts.join(' · ') : 'masked';
}

/** One-time boot log: adapter, power preference, and the limits that matter. */
function logGpuContext(ctx: GpuContext): void {
    const limits = ctx.limits ?? {};
    const notable = Object.keys(ctx.requiredLimits)
        .map((key) => `${key}=${limits[key] ?? '?'}/${ctx.requiredLimits[key]}`)
        .join(' ');

    console.log(
        `[GPUContext] Single WebGPU device owned by the renderer · ` +
            `adapter=${describeAdapter(ctx.adapterInfo)} · ` +
            `powerPreference=${ctx.powerPreference} · ${notable}`
    );
}

/** Test hook: reset module state. Not used by the app. */
export function __resetGpuContextForTests(): void {
    context = { ...UNAVAILABLE };
    contextPromise = null;
    resolveContext = null;
    armed = false;
    probePromise = null;
    probeReport = null;
    deviceLostListeners.clear();
    gpuErrorCount = 0;
    gpuErrors = [];
    contextRestored = false;
    canvasAntialias = false;
}

// Make the (unavailable) context visible even before boot completes, so the
// smoke tests can always read `window.__gpuContext`.
publishGpuContext();
