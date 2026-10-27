/**
 * Device-loss recovery: rebuild the renderer on a fresh device, in place.
 *
 * Three r186 has no recovery of its own, but `Renderer.init()` builds every
 * manager (nodes, textures, geometries, pipelines, bindings, render contexts)
 * from scratch. Swapping in a new backend and running `init()` again on the
 * same renderer object therefore drops every object of the dead device and
 * re-creates each one from its CPU-side source on first use: textures from
 * their images and data, buffers from their arrays, materials and the post
 * graph from their nodes. Every module that holds the renderer keeps a valid
 * reference. What only ever lived on the GPU (render-target contents, compute
 * results, TRAA history) starts over.
 *
 * `gpu-context.ts` decides what counts as recoverable and owns the shared
 * context; everything that only runs once a device is lost (the retries, the
 * rebuild, the banner, `?debug_lose_device`) lives here, in the lazy
 * `device-recovery` chunk, and reaches back through a {@link RecoveryHost}.
 * Leaf module: no imports, so `app` carries none of it.
 */

type AnimationLoop = ((time: number, frame?: unknown) => void) | null;

interface BackendLike {
    parameters: Record<string, unknown>;
    /** WebGL backend only: its `webglcontextlost` listener on the canvas. */
    _onContextLost?: EventListener;
}

type BackendCtor = new (parameters: Record<string, unknown>) => BackendLike;

/** The parts of three's `Renderer` this touches (several are private). */
export interface RecoverableRenderer {
    backend: BackendLike;
    domElement?: { removeEventListener(type: string, listener: EventListener): void };
    _animation?: {
        getAnimationLoop(): AnimationLoop;
        setAnimationLoop(callback: AnimationLoop): void;
        stop(): void;
    } | null;
    _initialized?: boolean;
    _initPromise?: Promise<unknown> | null;
    _isDeviceLost?: boolean;
    _getFallback?: unknown;
    init(): Promise<unknown>;
    setAnimationLoop(callback: AnimationLoop): unknown;
}

/** How to build the backend again: its class and the parameters it was given. */
export interface BackendRecipe {
    Backend: BackendCtor;
    parameters: Record<string, unknown>;
}

export function captureBackendRecipe(renderer: RecoverableRenderer): BackendRecipe {
    const backend = renderer.backend;
    return {
        Backend: backend.constructor as BackendCtor,
        parameters: { ...backend.parameters },
    };
}

/**
 * Stop calling the frame loop (the scheduler runs inside it) and hand it back
 * for {@link resumeFrames}. Three's own rAF keeps ticking with no callback.
 */
export function pauseFrames(renderer: RecoverableRenderer): AnimationLoop {
    const animation = renderer._animation;
    const loop = animation?.getAnimationLoop() ?? null;
    animation?.setAnimationLoop(null);
    return loop;
}

/** Re-attach the loop {@link pauseFrames} took, on whatever animation `init()` left. */
export function resumeFrames(renderer: RecoverableRenderer, loop: AnimationLoop): void {
    if (loop) void renderer.setAnimationLoop(loop);
}

/**
 * Give the renderer a new backend and initialise it again.
 *
 * `overrides` replaces recipe parameters; WebGPU passes the new device and
 * canvas context so the backend requests nothing itself. The WebGPU
 * renderer's WebGL fallback is off for the call: recovery must come back on
 * the backend that was lost, or fail.
 */
export async function reinitRenderer(
    renderer: RecoverableRenderer,
    recipe: BackendRecipe,
    overrides: Record<string, unknown> = {}
): Promise<void> {
    const dead = renderer.backend;
    // The dead WebGL backend still listens for context loss. Its dispose()
    // would lose the (restored) context again, so only drop the listener.
    if (dead?._onContextLost) {
        renderer.domElement?.removeEventListener('webglcontextlost', dead._onContextLost);
    }
    renderer._animation?.stop();

    renderer.backend = new recipe.Backend({ ...recipe.parameters, ...overrides });
    renderer._initialized = false;
    renderer._initPromise = null;
    renderer._isDeviceLost = false;

    const fallback = renderer._getFallback;
    renderer._getFallback = null;
    try {
        await renderer.init();
    } catch (err) {
        renderer._isDeviceLost = true;
        throw err;
    } finally {
        renderer._getFallback = fallback;
    }
    if (renderer.backend.constructor !== recipe.Backend) {
        renderer._isDeviceLost = true;
        throw new Error('renderer came back on a different backend');
    }
}

export interface RetryResult {
    ok: boolean;
    attempts: number;
    errors: unknown[];
}

/** Run `step` until it resolves, at most `attempts` times, `delayMs` apart. */
export async function retry(
    step: (attempt: number) => Promise<void>,
    attempts: number,
    delayMs: number,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<RetryResult> {
    const errors: unknown[] = [];
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await step(attempt);
            return { ok: true, attempts: attempt, errors };
        } catch (err) {
            errors.push(err);
            if (attempt < attempts && delayMs > 0) await sleep(delayMs);
        }
    }
    return { ok: false, attempts, errors };
}

/**
 * Losses that keep coming back are not worth chasing: past `limit` recoveries
 * inside `windowMs`, the next loss goes straight to the banner.
 */
export function isLossStorm(
    recoveredAt: readonly number[],
    now: number,
    limit: number,
    windowMs: number
): boolean {
    let recent = 0;
    for (const t of recoveredAt) if (now - t < windowMs) recent++;
    return recent >= limit;
}

// =============================================================================
// THE RECOVERY LOOP
// =============================================================================

/** Two tries, a second apart; the banner only shows when both fail. */
const RECOVERY_ATTEMPTS = 2;
/** Past this many recoveries a minute, the next loss goes to the banner. */
const LOSS_STORM_LIMIT = 3;
const LOSS_STORM_WINDOW_MS = 60_000;

interface ProbedDevice {
    device: GPUDevice;
    context: GPUCanvasContext;
}

/** What `gpu-context.ts` hands the loop: its probe, and how to adopt the result. */
export interface RecoveryHost<P extends ProbedDevice = ProbedDevice> {
    backend: 'webgpu' | 'webgl';
    renderer: RecoverableRenderer;
    /** Recipe captured on the first loss (the backend class and its parameters). */
    recipe: BackendRecipe | null;
    recoveredAt: readonly number[];
    retryMs: number;
    restoreTimeoutMs: number;
    /** WebGPU: the boot probe again (adapter, device, canvas configure, compute). */
    probe(canvas: HTMLCanvasElement): Promise<P>;
    /** Make the context current again: the probed device, or (WebGL2) the restored one. */
    adopt(probe: P | null): void;
    /** WebGL2: settles once the browser hands the context back. */
    contextRestored(): Promise<void>;
}

/**
 * Rebuild the renderer with the frame loop paused (the scheduler runs inside
 * it), then resume it. Resolves false when both attempts fail, or the device
 * keeps getting lost; the caller shows the banner then.
 */
export async function recoverGraphics<P extends ProbedDevice>(
    host: RecoveryHost<P>,
    what: string
): Promise<boolean> {
    if (isLossStorm(host.recoveredAt, performance.now(), LOSS_STORM_LIMIT, LOSS_STORM_WINDOW_MS)) {
        console.warn(`[GPUContext] ${what} lost again too soon after recovering — not retrying`);
        return false;
    }
    console.warn('[GPUContext] Rebuilding the renderer after the loss');
    const renderer = host.renderer;
    const recipe = (host.recipe ??= captureBackendRecipe(renderer));
    const loop = pauseFrames(renderer);
    const result = await retry(() => rebuild(host, recipe), RECOVERY_ATTEMPTS, host.retryMs);
    if (!result.ok) {
        // A renderer that failed init cannot run frames; leave the loop paused
        // behind the banner rather than re-entering init each tick.
        console.warn(
            `[GPUContext] Recovery failed ${result.attempts}×: ` +
                result.errors.map((e) => (e instanceof Error ? e.message : String(e))).join(' | ')
        );
        return false;
    }
    resumeFrames(renderer, loop);
    return true;
}

/** One attempt: a new device (or the restored context), then `init()` on it. */
async function rebuild<P extends ProbedDevice>(
    host: RecoveryHost<P>,
    recipe: BackendRecipe
): Promise<void> {
    if (host.backend === 'webgl') {
        await withTimeout(host.contextRestored(), host.restoreTimeoutMs, 'context not restored');
        await reinitRenderer(host.renderer, recipe);
        host.adopt(null);
        return;
    }
    const canvas = (host.renderer as { domElement?: HTMLCanvasElement }).domElement;
    if (!canvas) throw new Error('renderer has no canvas');
    const probe = await host.probe(canvas);
    try {
        await reinitRenderer(host.renderer, recipe, {
            device: probe.device,
            context: probe.context,
        });
    } catch (err) {
        probe.device.destroy();
        throw err;
    }
    host.adopt(probe);
}

function withTimeout(promise: Promise<void>, ms: number, message: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${message} within ${ms} ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * `?debug_lose_device`: lose the device on purpose. WebGPU: `device.destroy()`
 * (the caller marks it, so its `destroyed` reason still counts as
 * recoverable). WebGL2: `WEBGL_lose_context`, handed back a second later.
 */
export function loseDeviceForDebug(
    device: GPUDevice | null,
    gl: WebGL2RenderingContext | null
): void {
    if (device) {
        console.warn('[GPUContext] ?debug_lose_device: destroying the device');
        device.destroy();
        return;
    }
    const lose = gl?.getExtension('WEBGL_lose_context');
    if (!lose) return;
    console.warn('[GPUContext] ?debug_lose_device: losing the WebGL2 context');
    lose.loseContext();
    setTimeout(() => lose.restoreContext(), 1000);
}

// =============================================================================
// THE BANNER
// =============================================================================

/** Banner text. Shown once recovery has failed; only a reload helps then. */
export const GRAPHICS_STOPPED_LABEL = 'Graphics stopped';

/**
 * Loss notice, styled after the existing renderer badge
 * (`src/ui/mode-badge.ts`) — a fixed pill, no modal, no input capture.
 */
export function showGraphicsStoppedBanner(detail: string): void {
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
