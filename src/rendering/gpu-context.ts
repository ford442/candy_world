<<<<<<< HEAD
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

export interface WebGPULimits {
    maxStorageBufferBindingSize: number;
    maxComputeWorkgroupSizeX: number;
    maxVertexBuffers: number;
    maxVertexAttributes: number;
    maxBindGroups: number;
}

export class GPUContext {
    private static instance: GPUContext;

    private _device: GPUDevice | null = null;
    private _adapter: GPUAdapter | null = null;
    private _renderer: WebGPURenderer | null = null;
    private _limits: WebGPULimits | null = null;
    private _ready = false;
    private _initPromise: Promise<void> | null = null;

    private constructor() {}

    public static getInstance(): GPUContext {
        if (!GPUContext.instance) {
            GPUContext.instance = new GPUContext();
        }
        return GPUContext.instance;
    }

    public isReady(): boolean {
        return this._ready && this._device !== null;
    }

    public getDevice(): GPUDevice | null {
        return this._device;
    }

    public getAdapter(): GPUAdapter | null {
        return this._adapter;
    }

    public getRenderer(): WebGPURenderer | null {
        return this._renderer;
    }

    public getLimits(): WebGPULimits | null {
        return this._limits;
    }

    /**
     * Initializes the WebGPU context with a shared device via WebGPURenderer.
     * Configures context options, awaits initialization, and extracts the adapter/device.
     * Sets up device lost handling on the render path.
     */
    public async init(canvas: HTMLCanvasElement): Promise<WebGPURenderer> {
        if (this._initPromise) {
            await this._initPromise;
            if (this._renderer) return this._renderer;
            throw new Error('GPUContext initialization previously failed.');
        }

        this._initPromise = this._initInternal(canvas);
        await this._initPromise;
        return this._renderer!;
    }

    private async _initInternal(canvas: HTMLCanvasElement): Promise<void> {
        // Instantiate WebGPURenderer with explicit parameters.
        // powerPreference: 'high-performance' helps avoid fallback to integrated GPUs when discrete is available.
        this._renderer = new WebGPURenderer({
            canvas,
            antialias: true,
            parameters: {
                powerPreference: 'high-performance',
                requiredLimits: {
                    maxStorageBufferBindingSize: 134217728, // 128 MB (required by compute-particles/library)
                    maxComputeWorkgroupSizeX: 256
                }
            }
        });

        // Initialize the renderer backend and wait for device creation.
        await this._renderer.init();

        const backend = (this._renderer as any).backend;
        if (!backend || !backend.device || !backend.adapter) {
            this._ready = false;
            throw new Error('WebGPUBackend failed to initialize device or adapter.');
        }

        this._device = backend.device;
        this._adapter = backend.adapter;

        // Cache limits for other components (e.g., webgpu-limits.ts, compute)
        this._limits = {
            maxStorageBufferBindingSize: this._device!.limits.maxStorageBufferBindingSize,
            maxComputeWorkgroupSizeX: this._device!.limits.maxComputeWorkgroupSizeX,
            maxVertexBuffers: this._device!.limits.maxVertexBuffers,
            maxVertexAttributes: this._device!.limits.maxVertexAttributes,
            maxBindGroups: this._device!.limits.maxBindGroups
        };

        this._ready = true;
        console.log('[GPUContext] Device and renderer initialized successfully');

        // Manage device lost recovery
        this._device!.lost.then((info: GPUDeviceLostInfo) => {
            console.error(`[GPUContext] WebGPU Device Lost: ${info.message} (Reason: ${info.reason})`);
            this._ready = false;
            this._device = null;
            this._adapter = null;
            this._renderer = null;

            // Device lost recovery: Soft disable GPU compute, force reload of the UI/app
            // so we never get a silent black canvas.
            this.handleDeviceLost(info);
        });
    }

    private handleDeviceLost(info: GPUDeviceLostInfo) {
        // Create an assertive ARIA-compliant recovery modal over the canvas
        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        overlay.style.color = 'white';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '9999';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'device-lost-title');

        const content = document.createElement('div');
        content.style.textAlign = 'center';
        content.style.maxWidth = '600px';
        content.style.padding = '2rem';
        content.style.background = '#222';
        content.style.borderRadius = '8px';

        const title = document.createElement('h2');
        title.id = 'device-lost-title';
        title.innerText = 'Graphics Device Lost';
        title.style.color = '#ff6b6b';

        const desc = document.createElement('p');
        desc.innerText = `The WebGPU device was lost. This can happen due to system resource pressure or if the graphics driver was updated.\n\nReason: ${info.message}`;
        desc.style.marginBottom = '1.5rem';

        const btn = document.createElement('button');
        btn.innerText = 'Reload Game';
        btn.style.padding = '10px 20px';
        btn.style.fontSize = '16px';
        btn.style.cursor = 'pointer';
        btn.style.background = '#339af0';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '4px';
        btn.onclick = () => window.location.reload();

        content.appendChild(title);
        content.appendChild(desc);
        content.appendChild(btn);
        overlay.appendChild(content);

        document.body.appendChild(overlay);
        btn.focus();
    }
}

export const gpuContext = GPUContext.getInstance();
=======
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

    if (mode !== 'webgpu') {
        console.log(`[GPUContext] WebGL backend active — GPU compute disabled (${reason ?? 'webgl'})`);
        return settle({
            ...UNAVAILABLE,
            backend: 'webgl',
            reason: reason ?? 'webgl-backend',
        });
    }

    const r = renderer as any;

    try {
        // `Renderer.init()` throws when called after it has already completed,
        // and shares its in-flight promise otherwise.
        if (typeof r.hasInitialized === 'function' ? !r.hasInitialized() : !r._initialized) {
            await r.init();
        }
    } catch (err) {
        console.warn('[GPUContext] renderer.init() failed — GPU compute disabled:', err);
        return settle({
            ...UNAVAILABLE,
            backend: 'webgpu',
            reason: 'renderer-init-failed',
        });
    }

    const backend = r.backend;
    const device: GPUDevice | null = backend?.device ?? null;

    if (!device || !backend?.isWebGPUBackend) {
        // Three silently fell back to its internal WebGL2 backend.
        console.warn('[GPUContext] Renderer has no WebGPU device — GPU compute disabled');
        return settle({
            ...UNAVAILABLE,
            backend: 'webgpu',
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
>>>>>>> ff6e32bf3c6218a7e2c8f1413dc8f9e3eefc43c7
