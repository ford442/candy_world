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
 *                    └─▶ await renderer.init()
 *                    └─▶ assert the WebGPU backend won
 *                    └─▶ resolve getGpuContext()
 * ```
 *
 * WebGPU is **required**: a failed probe throws `WebGPUUnavailableError` and
 * boot stops at a hard-fail screen. There is no WebGL rescue in this phase.
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
 * Limits requested for the shared device.
 *
 * Every value here is exactly a WebGPU spec **default** (guaranteed by any
 * conformant adapter, including SwiftShader), so `requestDevice` can never be
 * rejected for asking too much. They are stated explicitly rather than left
 * implicit because compute shaders bind against these ceilings:
 *
 * - `maxStorageBufferBindingSize` 128 MiB — matches what
 *   `gpu-compute-library.ts` and `compute-particles.ts` used to request from
 *   their own devices. Keeping the number identical means moving them onto
 *   the renderer's device cannot shrink a binding that used to fit.
 * - `maxComputeWorkgroupSizeX` / `maxComputeInvocationsPerWorkgroup` 256 —
 *   the workgroup size declared by the particle and culling WGSL kernels.
 * - `maxComputeWorkgroupStorageSize` 16 KiB — headroom for tiled kernels.
 *
 * Actual granted limits are usually higher; read them from
 * {@link getGpuContextSync}`().limits` rather than assuming these values.
 */
export const GPU_REQUIRED_LIMITS: Record<string, number> = {
    maxStorageBufferBindingSize: 134217728,
    maxComputeWorkgroupSizeX: 256,
    maxComputeInvocationsPerWorkgroup: 256,
    maxComputeWorkgroupStorageSize: 16384,
};

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
 * Hardware MSAA on the swap chain.
 *
 * Kept `true`, matching the pre-existing renderer. The post chain
 * (`initPostProcessing`) does not run a full-screen AA resolve of its own, so
 * MSAA is still the only geometric antialiasing in the pipeline; dropping it
 * in favour of post-AA would be a visual change and is out of scope here.
 */
export const GPU_ANTIALIAS = true;

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
    requiredLimits: Record<string, number>;
    /** True once the device has been lost. */
    lost: boolean;
    lostReason: string | null;
    /** Why WebGPU is unavailable, when it is. */
    reason: string | null;
}

type DeviceLostListener = (reason: string) => void;

// =============================================================================
// STATE
// =============================================================================

const UNAVAILABLE: GpuContext = {
    // There is no WebGL path in this phase: `webgpu` + `available: false` means
    // "the only supported backend, not brought up yet", never "we fell back".
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
    | 'renderer';

/**
 * WebGPU could not be brought up, so boot must stop.
 *
 * There is no WebGL rescue in this phase: a silent GL render is precisely what
 * hides the Chrome-vs-Edge adapter bug this probe exists to expose. Callers
 * show the hard-fail screen instead of constructing a renderer.
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
export interface GpuProbeResult {
    adapter: GPUAdapter;
    device: GPUDevice;
    context: GPUCanvasContext;
    adapterInfo: GpuAdapterInfo | null;
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
    limits: Record<string, number> | null;
    powerPreference: GPUPowerPreference;
    requiredLimits: Record<string, number>;
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
    const ua = navigator.userAgent ?? '';
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

    const fail = (stage: GpuProbeStage, message: string, detail?: unknown): never => {
        publishProbeReport({
            ok: false,
            stage,
            reason: message,
            browser,
            adapter: adapterInfo,
            adapterName: describeAdapter(adapterInfo),
            isFallbackAdapter: Boolean(
                (adapter as (GPUAdapter & { isFallbackAdapter?: boolean }) | null)
                    ?.isFallbackAdapter
            ),
            limits: device ? snapshotLimits(device.limits) : null,
            powerPreference: GPU_POWER_PREFERENCE,
            requiredLimits: GPU_REQUIRED_LIMITS,
            timestamp: new Date().toISOString(),
        });
        // A half-built device would otherwise sit pinned until GC.
        try {
            device?.destroy();
        } catch {
            /* destroy is best-effort */
        }
        settle({ ...UNAVAILABLE, reason: `${stage}: ${message}` });
        console.error(
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
        adapter = await navigator.gpu.requestAdapter({
            powerPreference: GPU_POWER_PREFERENCE,
        });
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

    // 3 — device. Match Three's own descriptor: every feature the adapter
    // supports, plus our required limits. Asking for exactly what Three would
    // ask for means adopting this device cannot cost a feature.
    try {
        device = await adapter.requestDevice({
            requiredFeatures: Array.from(adapter.features) as GPUFeatureName[],
            requiredLimits: GPU_REQUIRED_LIMITS,
        });
    } catch (err) {
        return fail('device', `requestDevice() rejected: ${describeError(err)}`, err);
    }
    if (!device) {
        return fail('device', 'requestDevice() resolved without a device');
    }
    adapterInfo = (await readAdapterInfo(adapter, device)) ?? adapterInfo;

    // 4 — canvas context
    let ctx: GPUCanvasContext | null = null;
    try {
        ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
    } catch (err) {
        return fail('canvas', `canvas.getContext('webgpu') threw: ${describeError(err)}`, err);
    }
    if (!ctx) {
        return fail(
            'canvas',
            "canvas.getContext('webgpu') returned null — the canvas already holds a context of another type, or WebGPU canvas support is off"
        );
    }

    // 5 — configure the swap chain exactly as Three will
    try {
        ctx.configure({
            device,
            format: navigator.gpu.getPreferredCanvasFormat(),
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
            alphaMode: GPU_ALPHA ? 'premultiplied' : 'opaque',
        });
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
        if (scoped) {
            return fail('pipeline', `compute pipeline validation failed: ${scoped.message}`, scoped);
        }
    } catch (err) {
        // `fail()` throws, so a validation error caught here would otherwise be
        // reported (and the device destroyed) a second time.
        if (err instanceof WebGPUUnavailableError) throw err;
        return fail('pipeline', `compute pipeline creation failed: ${describeError(err)}`, err);
    }

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
        requiredLimits: GPU_REQUIRED_LIMITS,
        timestamp: new Date().toISOString(),
    });

    console.log(
        `[GPUContext] WebGPU probe passed on ${browser.name} ${browser.version} · adapter=${describeAdapter(adapterInfo)}`
    );

    return { adapter, device, context: ctx, adapterInfo };
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
export async function armGpuContext(
    renderer: unknown,
    probe: GpuProbeResult
): Promise<GpuContext> {
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
        return fatal('Renderer is not a WebGPURenderer — WebGPU is required to enter the world');
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
        requiredLimits: GPU_REQUIRED_LIMITS,
        lost: false,
        lostReason: null,
        reason: null,
    };

    registerDeviceLost(device, r);
    logGpuContext(next);
    return settle(next);
}

// =============================================================================
// DEVICE LOSS
// =============================================================================

function registerDeviceLost(device: GPUDevice, renderer: any): void {
    // Every loss is treated as a fault, including `reason: 'destroyed'`:
    // nothing in the app destroys the shared device anymore (compute and
    // particles release their own buffers and leave the device alone), so a
    // destroy here means something external tore it down and the render path
    // is dead either way.
    device.lost
        .then((info: GPUDeviceLostInfo) => {
            handleDeviceLost(info?.message || info?.reason || 'unknown reason');
        })
        .catch(() => {
            /* `device.lost` never rejects; guard defensively anyway. */
        });

    // Three's default `onDeviceLost` only logs. Route it through the same
    // handler so the render path degrades exactly once, however loss surfaces.
    if (renderer && typeof renderer === 'object') {
        renderer.onDeviceLost = (info: { message?: string; reason?: string | null }) => {
            handleDeviceLost(info?.message || info?.reason || 'unknown reason');
        };
    }
}

function handleDeviceLost(message: string): void {
    if (context.lost) return;

    context = { ...context, available: false, device: null, lost: true, lostReason: message };
    publishGpuContext();

    console.warn(`[GPUContext] WebGPU device lost: ${message} — GPU compute disabled`);

    for (const listener of deviceLostListeners) {
        try {
            listener(message);
        } catch (err) {
            console.warn('[GPUContext] Device-lost listener threw:', err);
        }
    }

    showDeviceLostBanner(message);
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

/**
 * Soft-fallback notice, styled after the existing renderer badge
 * (`src/ui/mode-badge.ts`) — a fixed pill, no modal, no input capture.
 */
function showDeviceLostBanner(message: string): void {
    if (typeof document === 'undefined' || !document.body) return;
    if (document.getElementById('gpu-device-lost-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'gpu-device-lost-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.title = `WebGPU device lost: ${message}`;

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
    label.textContent = 'GPU CONNECTION LOST — effects reduced';
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
        antialias: GPU_ANTIALIAS,
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
    const notable = Object.keys(GPU_REQUIRED_LIMITS)
        .map((key) => `${key}=${limits[key] ?? '?'}`)
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
}

// Make the (unavailable) context visible even before boot completes, so the
// smoke tests can always read `window.__gpuContext`.
publishGpuContext();
