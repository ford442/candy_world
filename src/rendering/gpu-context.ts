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
 * Lifecycle:
 * ```
 *   init.ts  ──▶ captureAdapterRequests()      (wrap requestAdapter once)
 *            ──▶ new WebGPURenderer({ ... })   (Three requests adapter+device)
 *            ──▶ armGpuContext(renderer, mode)
 *                    └─▶ await renderer.init()
 *                    └─▶ adopt renderer.backend.device
 *                    └─▶ resolve getGpuContext()
 * ```
 *
 * Consumers:
 * ```ts
 * const device = await awaitGpuDevice();
 * if (!device) return this.initCPUFallback();  // fail closed, never throw
 * ```
 *
 * @see docs/WEBGPU_CONTEXT.md
 */

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
    /** The one owned device, or null on the WebGL path / after loss. */
    device: GPUDevice | null;
    /** Adapter Three requested, captured without issuing a second request. */
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
    backend: 'webgl',
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

/** Adapter captured from the renderer's own `requestAdapter` call. */
let capturedAdapter: GPUAdapter | null = null;
let captureInstalled = false;

function ensurePromise(): Promise<GpuContext> {
    if (!contextPromise) {
        contextPromise = new Promise<GpuContext>((resolve) => {
            resolveContext = resolve;
        });
    }
    return contextPromise;
}

function settle(next: GpuContext): GpuContext {
    context = next;
    ensurePromise();
    if (resolveContext) {
        resolveContext(context);
        resolveContext = null;
    }
    publishGpuContext();
    return context;
}

// =============================================================================
// ADAPTER CAPTURE
// =============================================================================

/**
 * Record the adapter that the renderer requests, without requesting one of our
 * own. Three discards the adapter after `WebGPUBackend.init()`, but we want its
 * name and limits for the boot log, so we intercept exactly one call.
 *
 * Must be invoked *before* the `WebGPURenderer` is constructed. Idempotent.
 */
export function captureAdapterRequests(): void {
    if (captureInstalled) return;
    if (typeof navigator === 'undefined' || !(navigator as any).gpu) return;

    captureInstalled = true;
    const gpu = (navigator as any).gpu;
    const original = gpu.requestAdapter.bind(gpu);

    gpu.requestAdapter = async (...args: any[]) => {
        const adapter = await original(...args);
        if (adapter && !capturedAdapter) {
            capturedAdapter = adapter;
            // One-shot: restore immediately so no other caller is intercepted.
            gpu.requestAdapter = original;
        }
        return adapter;
    };
}

async function readAdapterInfo(
    adapter: GPUAdapter | null,
    device: GPUDevice | null,
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
 * Adopt the renderer's device as the process-wide GPU context.
 *
 * Resolves the shared context in every case — including the WebGL path and
 * WebGPU initialisation failure — so consumers awaiting {@link getGpuContext}
 * never hang. Never throws.
 *
 * @param renderer The renderer created by `init.ts` (WebGPU or WebGL).
 * @param mode The backend actually in use.
 * @param reason Fallback reason when `mode` is `webgl`.
 */
export async function armGpuContext(
    renderer: unknown,
    mode: RendererBackend,
    reason: string | null = null,
): Promise<GpuContext> {
    if (armed) return ensurePromise();
    armed = true;
    ensurePromise();

    const r = renderer as { isWebGPURenderer?: boolean; hasInitialized?: () => boolean; _initialized?: boolean; init?: () => Promise<void>; backend?: { isWebGLBackend?: boolean; isWebGPUBackend?: boolean; device?: GPUDevice } };

    // Legacy THREE.WebGLRenderer (pre-0.171 fallback) — no node backend, no GPU compute.
    if (!r?.isWebGPURenderer) {
        console.log(`[GPUContext] WebGL backend active — GPU compute disabled (${reason ?? 'webgl'})`);
        return settle({
            ...UNAVAILABLE,
            backend: 'webgl',
            reason: reason ?? 'webgl-backend',
        });
    }

    try {
        // `Renderer.init()` throws when called after it has already completed,
        // and shares its in-flight promise otherwise.
        if (typeof r.hasInitialized === 'function' ? !r.hasInitialized() : !r._initialized) {
            await r.init!();
        }
    } catch (err) {
        console.warn('[GPUContext] renderer.init() failed — GPU compute disabled:', err);
        return settle({
            ...UNAVAILABLE,
            backend: mode,
            reason: 'renderer-init-failed',
        });
    }

    const backend = r.backend;

    if (backend?.isWebGLBackend === true) {
        console.log(`[GPUContext] WebGL backend active — GPU compute disabled (${reason ?? 'webgl-node-backend'})`);
        return settle({
            ...UNAVAILABLE,
            backend: 'webgl',
            reason: reason ?? 'webgl-node-backend',
        });
    }

    const device: GPUDevice | null = backend?.device ?? null;

    if (!device || !backend?.isWebGPUBackend) {
        // Three silently fell back to its internal WebGL2 backend.
        console.warn('[GPUContext] Renderer has no WebGPU device — GPU compute disabled');
        return settle({
            ...UNAVAILABLE,
            backend: 'webgl',
            reason: 'no-webgpu-device',
        });
    }

    const adapter = capturedAdapter;
    const adapterInfo = await readAdapterInfo(adapter, device);

    const next: GpuContext = {
        backend: 'webgpu',
        available: true,
        device,
        adapter,
        limits: snapshotLimits(device.limits),
        adapterInfo,
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
 * Await the shared GPU context. Resolves once the renderer has been armed;
 * resolves to an unavailable context on the WebGL path.
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
    }
}

/** Mirror the context onto `window.__gpuContext` for tests and the debug panel. */
export function publishGpuContext(): void {
    if (typeof window === 'undefined') return;

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
    capturedAdapter = null;
    deviceLostListeners.clear();
}

// Make the (unavailable) context visible even before boot completes, so the
// smoke tests can always read `window.__gpuContext`.
publishGpuContext();
