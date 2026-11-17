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
import { GPU_OPTIONAL_FEATURES, type GpuOptionalFeature } from '../core/platform/capabilities.ts';
import { readUserAgent } from '../core/platform/user-agent.ts';
import type { BackendRecipe, RecoverableRenderer, RecoveryHost } from './device-recovery.ts';
import {
    GPU_ALPHA,
    GPU_DESIRED_LIMITS,
    GPU_POWER_PREFERENCE,
    GPU_REQUIRED_LIMITS,
    HDR_CANVAS_FORMAT,
    resolveCanvasConfig,
    resolveHdrIntent,
    resolveRequiredLimits,
    selectRequiredFeatures,
    toConfiguration,
    type GpuAdapterInfo,
    type GpuCanvasConfig,
    type GpuHdrReport,
} from './gpu-context-policy.ts';
import type { RendererBackend } from './renderer-mode.ts';

// The request/configuration policy is pure and lives in `gpu-context-policy.ts`;
// re-exported so this module's public surface is unchanged. This file still
// owns the only `requestAdapter()` / `requestDevice()` call, device adoption,
// diagnostics and recovery.
export {
    GPU_ALPHA,
    GPU_DESIRED_LIMITS,
    GPU_OPTIONAL_FEATURES,
    GPU_POWER_PREFERENCE,
    GPU_REQUIRED_FEATURES,
    GPU_REQUIRED_LIMITS,
    HDR_CANVAS_FORMAT,
    SCENE_PASS_SAMPLES,
    resolveCanvasAntialias,
    resolveCanvasColorSpace,
    resolveRequiredLimits,
    selectRequiredFeatures,
    wantsExtendedRange,
    wantsOptionalGpuFeatures,
    wantsTimestampQuery,
    type GpuAdapterInfo,
    type GpuCanvasConfig,
    type GpuHdrReport,
    type GpuOptionalFeature,
} from './gpu-context-policy.ts';

// =============================================================================
// CONTEXT OPTIONS (the single source of truth for renderer construction)
// =============================================================================

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
 * True when the context reports the extended-range configure it was given.
 * Browsers drop dictionary members they do not know, so a configure with
 * `toneMapping: { mode: 'extended' }` can succeed and still be standard
 * range; `getConfiguration()` is the only way to tell. Without it we cannot
 * verify, and stay on SDR.
 */
function extendedRangeTook(ctx: GPUCanvasContext): boolean {
    try {
        const applied = (
            ctx as GPUCanvasContext & {
                getConfiguration?: () => GPUCanvasConfiguration | null;
            }
        ).getConfiguration?.();
        return applied?.toneMapping?.mode === 'extended' && applied.format === HDR_CANVAS_FORMAT;
    } catch {
        return false;
    }
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

// --- Recovery (the loop itself is `device-recovery.ts`, a lazy chunk) -------
let recoveryTiming = { retryMs: 1000, restoreTimeoutMs: 10_000 };
/** The renderer whose loss is being watched; recovery rebuilds it in place. */
let lossRenderer: RecoverableRenderer | null = null;
let backendRecipe: BackendRecipe | null = null;
/** The loss being settled: recovery, or the banner. */
let recovery: Promise<boolean> | null = null;
let recoveredAt: number[] = [];
/** Set by `?debug_lose_device` just before it destroys the device on purpose. */
let simulatedLoss = false;
/** WebGL2: settles when the browser hands the context back. */
let contextRestoredSignal: Promise<void> | null = null;
let resolveContextRestored: (() => void) | null = null;
const deviceRestoredListeners = new Set<() => void>();

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

/** Per optional feature: advertised by the adapter, asked for, granted by the device. */
export interface GpuFeatureTrace {
    adapter: boolean;
    requested: boolean;
    granted: boolean;
}

export interface GpuFeatureReport {
    /** Adapter-advertised. Logging only — not passed to requestDevice. */
    adapter: GPUFeatureName[];
    /** Allowlist actually passed as requiredFeatures. */
    requested: GPUFeatureName[];
    /** device.features, or null before a device exists. */
    granted: GPUFeatureName[] | null;
    /** timestamp-query was wanted this boot and the device granted it. */
    timestampQuery: boolean;
    /** adapter / requested / granted for each of {@link GPU_OPTIONAL_FEATURES}. */
    optional: Record<GpuOptionalFeature, GpuFeatureTrace>;
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
    const advertised = adapter ? listFeatures(adapter.features) : [];
    const optional = {} as Record<GpuOptionalFeature, GpuFeatureTrace>;
    for (const name of GPU_OPTIONAL_FEATURES) {
        optional[name] = {
            adapter: advertised.includes(name),
            requested: requested.includes(name),
            granted: Boolean(granted?.includes(name)),
        };
    }
    return {
        adapter: advertised,
        requested: [...requested].sort(),
        granted,
        timestampQuery: Boolean(granted?.includes('timestamp-query')),
        optional,
    };
}

/** The optional features the probed device was granted (for platform capabilities). */
export function grantedOptionalFeatures(
    probe: GpuProbeResult | null | undefined
): GpuOptionalFeature[] {
    const optional = probe?.features?.optional;
    if (!optional) return [];
    return GPU_OPTIONAL_FEATURES.filter((name) => optional[name]?.granted);
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
    /** Swap-chain format / alphaMode / colorSpace / toneMapping, or null before configure. */
    canvas: Omit<GpuCanvasConfig, 'usage'> | null;
    /** Extended-range decision, or null before configure. */
    hdr: GpuHdrReport | null;
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
    let hdr: GpuHdrReport | null = null;

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
            hdr,
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
    // omits. SDR is the 8-bit `getPreferredCanvasFormat()` (usually
    // `bgra8unorm`). On an HDR display, unless HDR is off, try `rgba16float`
    // with extended tone mapping first and keep it only if the context
    // reports it back; any doubt lands on the SDR configure, which is the
    // one that can fail the probe.
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC;
    const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
    const sdrConfig = resolveCanvasConfig({ preferredFormat, usage, extended: false });
    const intent = resolveHdrIntent();
    hdr = intent.report;
    if (intent.wanted) {
        const hdrConfig = resolveCanvasConfig({ preferredFormat, usage, extended: true });
        hdr.attempted = true;
        try {
            ctx.configure(toConfiguration(device, hdrConfig));
            if (extendedRangeTook(ctx)) {
                canvasConfig = hdrConfig;
                hdr.configured = true;
            } else {
                hdr.reason = 'browser did not report an extended-range configuration';
            }
        } catch (err) {
            hdr.reason = `extended-range configure threw: ${describeError(err)}`;
        }
        if (!hdr.configured) {
            console.warn(`[GPUContext] HDR display, SDR swap chain: ${hdr.reason}`);
        }
    }
    if (!canvasConfig) {
        canvasConfig = sdrConfig;
        try {
            ctx.configure(toConfiguration(device, canvasConfig));
        } catch (err) {
            return fail('configure', `context.configure() threw: ${describeError(err)}`, err);
        }
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
        hdr,
        timestamp: new Date().toISOString(),
    });

    console.log(
        `[GPUContext] WebGPU probe passed on ${browser.name} ${browser.version} · adapter=${describeAdapter(adapterInfo)} · features=${features.granted?.join(',') || '(none)'} · swap chain=${canvasConfig.format}/${canvasConfig.toneMapping}`
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
    return {
        format: config.format,
        alphaMode: config.alphaMode,
        colorSpace: config.colorSpace,
        toneMapping: config.toneMapping,
    };
}

/** True when the probe configured an extended-range (HDR) swap chain. */
export function extendedRangeConfigured(probe: GpuProbeResult | null | undefined): boolean {
    return probe?.canvas?.toneMapping === 'extended';
}

interface PinnedCanvas {
    colorSpace: PredefinedColorSpace;
    toneMapping: GPUCanvasToneMappingMode;
}

const pinnedCanvas = new WeakMap<GPUCanvasContext, PinnedCanvas>();

/**
 * Three r186 configures the canvas lazily on the first frame, and again after
 * every resize (`updateSize()` drops its cached context), each time with only
 * device/format/usage/alphaMode/toneMapping, which resets `colorSpace` to
 * `srgb`. Keep the tag on the context instance so every later configure,
 * Three's included, carries it. Tone mapping is pinned too: Three derives it
 * from `outputType` (`init.ts` passes `HalfFloatType` exactly when the probe
 * went extended), and the pin keeps the two from drifting apart.
 */
function pinCanvasConfig(context: GPUCanvasContext, pin: PinnedCanvas): void {
    const wrapped = pinnedCanvas.has(context);
    pinnedCanvas.set(context, pin);
    if (wrapped) return;
    const configure = context.configure.bind(context);
    context.configure = (config: GPUCanvasConfiguration) => {
        const current = pinnedCanvas.get(context);
        configure(
            current
                ? {
                      ...config,
                      colorSpace: current.colorSpace,
                      toneMapping: { mode: current.toneMapping },
                  }
                : config
        );
    };
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
    const previous: PinnedCanvas = {
        colorSpace: probe.canvas.colorSpace,
        toneMapping: probe.canvas.toneMapping,
    };
    try {
        pinCanvasConfig(probe.context, { colorSpace, toneMapping: next.toneMapping });
        probe.context.configure(toConfiguration(probe.device, next));
        probe.canvas = next;
    } catch (err) {
        pinnedCanvas.set(probe.context, previous);
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

    const next = contextFromProbe(probe, device);
    lossRenderer = r as unknown as RecoverableRenderer;
    registerDeviceLost(device, r);
    registerUncapturedErrors(r);
    logGpuContext(next);
    scheduleDebugDeviceLoss();
    prefetchRecovery();
    return settle(next);
}

function contextFromProbe(probe: GpuProbeResult, device: GPUDevice): GpuContext {
    return {
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
        // Three never forwards `reason: 'destroyed'`, so this is always a fault.
        handleGraphicsLost(info?.message || info?.reason || 'unknown reason', true);
    };
}

function registerDeviceLost(device: GPUDevice, renderer: unknown): void {
    // Every loss stops rendering. A fault (driver reset, GPU process crash,
    // `reason: 'unknown'`) is worth a new device; `reason: 'destroyed'` is
    // not: nothing in the app destroys the shared device (compute and
    // particles release their own buffers and leave it alone), so a destroy
    // means something tore it down on purpose. `?debug_lose_device` marks the
    // destroy it does so that it exercises recovery all the same.
    device.lost
        .then((info: GPUDeviceLostInfo) => {
            const recoverable = info?.reason !== 'destroyed' || simulatedLoss;
            simulatedLoss = false;
            stopRenderer(renderer);
            handleGraphicsLost(info?.message || info?.reason || 'unknown reason', recoverable);
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
 * `webglcontextlost` and calls `renderer.onDeviceLost`; this listener keeps
 * loss handled if a Three upgrade stops doing that (both are idempotent).
 * Cancelling the event lets the browser hand the context back
 * (`webglcontextrestored`), and recovery then rebuilds the renderer on it.
 */
export function watchWebGLContextLoss(renderer: unknown, canvas: HTMLCanvasElement): void {
    lossRenderer = renderer as RecoverableRenderer;
    routeRendererLoss(renderer);
    canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        stopRenderer(renderer);
        handleGraphicsLost((event as WebGLContextEvent).statusMessage || 'context lost', true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
        contextRestored = true;
        resolveContextRestored?.();
        publishGpuContext();
        console.warn('[GPUContext] WebGL2 context restored');
    });
    scheduleDebugDeviceLoss();
    prefetchRecovery();
}

function handleGraphicsLost(message: string, recoverable: boolean): void {
    if (context.lost) return;

    const what = context.backend === 'webgl' ? 'WebGL2 context' : 'WebGPU device';
    context = { ...context, available: false, device: null, lost: true, lostReason: message };
    if (context.backend === 'webgl') {
        // Armed before anything can await, so a quick restore is not missed.
        contextRestored = false;
        contextRestoredSignal = new Promise<void>((resolve) => (resolveContextRestored = resolve));
    }
    recovery = settleLoss(what, message, recoverable && lossRenderer !== null);
    publishGpuContext();

    console.warn(`[GPUContext] ${what} lost: ${message} — rendering stopped`);

    for (const listener of deviceLostListeners) {
        try {
            listener(message);
        } catch (err) {
            console.warn('[GPUContext] Device-lost listener threw:', err);
        }
    }
}

/**
 * After a loss: rebuild the renderer in place (`device-recovery.ts`, a lazy
 * chunk; two attempts), or show the reload banner when the loss is not
 * recoverable or both attempts fail.
 */
async function settleLoss(what: string, message: string, recoverable: boolean): Promise<boolean> {
    // The lost listeners (CPU tiers) run first.
    await Promise.resolve();
    let ok = false;
    let rec: typeof import('./device-recovery.ts') | null = null;
    try {
        rec = await import('./device-recovery.ts');
        if (recoverable) ok = await rec.recoverGraphics(recoveryHost(lossRenderer!), what);
    } catch (err) {
        console.warn(`[GPUContext] Recovery could not run: ${describeError(err)}`);
    }
    if (!ok) rec?.showGraphicsStoppedBanner(`${what} lost: ${message}`);
    recovery = null;
    publishGpuContext();
    if (ok) {
        console.warn(`[GPUContext] ${what} recovered; rendering resumed`);
        for (const listener of deviceRestoredListeners) {
            try {
                listener();
            } catch (err) {
                console.warn('[GPUContext] Device-restored listener threw:', err);
            }
        }
    }
    return ok;
}

/** What the recovery loop needs from this module: the probe, and adopting its result. */
function recoveryHost(renderer: RecoverableRenderer): RecoveryHost<GpuProbeResult> {
    return {
        backend: context.backend === 'webgl' ? 'webgl' : 'webgpu',
        renderer,
        get recipe() {
            return backendRecipe;
        },
        set recipe(recipe) {
            backendRecipe = recipe;
        },
        recoveredAt,
        retryMs: recoveryTiming.retryMs,
        restoreTimeoutMs: recoveryTiming.restoreTimeoutMs,
        probe: async (canvas) => {
            probePromise = null;
            const lostContext = context;
            try {
                return await probeWebGPU(canvas);
            } catch (err) {
                // A failed probe settles the context as "unavailable"; it is still lost.
                context = lostContext;
                throw err;
            }
        },
        adopt: (probe) => {
            recoveredAt.push(performance.now());
            if (!probe) {
                context = { ...context, lost: false, lostReason: null };
                return;
            }
            context = contextFromProbe(probe, probe.device);
            registerDeviceLost(probe.device, renderer);
            const outputColorSpace = (renderer as { outputColorSpace?: string }).outputColorSpace;
            applyCanvasColorSpace(probe, outputColorSpace === 'display-p3' ? 'display-p3' : 'srgb');
        },
        contextRestored: () =>
            contextRestored
                ? Promise.resolve()
                : (contextRestoredSignal ??
                  Promise.reject(new Error('no context loss to wait for'))),
    };
}

/**
 * Subscribe to a successful recovery. The renderer itself needs nothing (it
 * was rebuilt in place); this is for systems that hold raw `GPUDevice` state
 * and can come back on the new device. Returns an unsubscribe function.
 */
export function onGpuDeviceRestored(listener: () => void): () => void {
    deviceRestoredListeners.add(listener);
    return () => deviceRestoredListeners.delete(listener);
}

/** Settles with the outcome of the loss in flight (true when there is none). */
export function whenGraphicsRecovered(): Promise<boolean> {
    return recovery ?? Promise.resolve(!context.lost);
}

/** Fetch the recovery chunk once boot has settled, so a loss never waits on the network. */
function prefetchRecovery(): void {
    const timer = setTimeout(() => void import('./device-recovery.ts').catch(() => {}), 10_000);
    (timer as { unref?: () => void }).unref?.();
}

/**
 * `?debug_lose_device[=seconds]`: once the scene is up, and `seconds` (5 by
 * default) later, lose the device on purpose so recovery can be watched.
 */
function scheduleDebugDeviceLoss(): void {
    if (typeof window === 'undefined' || typeof window.location === 'undefined') return;
    let flag: string | null = null;
    try {
        flag = new URLSearchParams(window.location.search).get('debug_lose_device');
    } catch {
        return;
    }
    if (flag === null) return;
    const delayMs = (Number(flag) > 0 ? Number(flag) : 5) * 1000;
    const waitForScene = () => {
        if ((window as { __sceneReady?: boolean }).__sceneReady === true) {
            setTimeout(() => void loseGpuDeviceForDebug(), delayMs);
        } else {
            setTimeout(waitForScene, 500);
        }
    };
    waitForScene();
}

/**
 * Lose the device on purpose (`?debug_lose_device`). The WebGPU destroy is
 * marked, so its `destroyed` reason still counts as recoverable.
 */
export async function loseGpuDeviceForDebug(): Promise<void> {
    if (context.lost) return;
    const { loseDeviceForDebug } = await import('./device-recovery.ts');
    const device = context.backend === 'webgpu' ? context.device : null;
    if (device) simulatedLoss = true;
    const gl = (lossRenderer as { backend?: { gl?: WebGL2RenderingContext } } | null)?.backend?.gl;
    loseDeviceForDebug(device, gl ?? null);
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
        recovering: recovery !== null,
        recoveries: recoveredAt.length,
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
    lossRenderer = null;
    backendRecipe = null;
    recovery = null;
    recoveredAt = [];
    simulatedLoss = false;
    contextRestoredSignal = null;
    resolveContextRestored = null;
    deviceRestoredListeners.clear();
}

/** Test hook: shorten the recovery retry delay and the WebGL restore wait. */
export function __setRecoveryTimingForTests(timing: {
    retryMs: number;
    restoreTimeoutMs: number;
}): void {
    recoveryTiming = { ...timing };
}

// Make the (unavailable) context visible even before boot completes, so the
// smoke tests can always read `window.__gpuContext`.
publishGpuContext();
