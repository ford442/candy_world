/**
 * Shader warm-up: compile the real scene's pipelines before they are drawn.
 *
 * TSL materials build their node graph, WGSL/GLSL module and render pipeline
 * on first draw (10–50 ms each), which hitches when a new foliage type enters
 * view. This compiles them ahead of time with `renderer.compileAsync()`.
 *
 * The previous warm-up rendered a fresh clone of each preset material into a
 * 1×1 HalfFloat target with no depth or MSAA and then disposed it, which also
 * released the pipeline; only the browser's own shader cache kept anything.
 * Compiling the real objects with the real camera and the real render target
 * keeps the render objects, node builder states and pipelines the next frame
 * looks up, so the first real frame finds them already built.
 *
 * Progressive: `compileAsync(scene, camera)` would project and build the whole
 * scene in one synchronous task. Instead each call sees one chunk of objects
 * through a spare camera layer ({@link WARMUP_LAYER}), and the event loop gets
 * a turn between chunks. The scene itself is still the root, so fog, the
 * environment and the full light list match a real frame and the compiled
 * programs are the ones the frame will use. Layers, culling flags and the
 * render target are swapped and restored synchronously around each call:
 * Three projects and builds before its first `await`, and no frame can run in
 * between, so a running game loop never sees the swapped state.
 */

import type * as THREE from 'three';

/** Camera layer used only during a compile call. Nothing else in src/ uses it. */
export const WARMUP_LAYER = 31;

/** Objects per `compileAsync` call. */
export const DEFAULT_CHUNK_SIZE = 48;

/** The render target (and MRT) the scene is really drawn into. */
export interface CompileTarget {
    renderTarget: THREE.RenderTarget | null;
    mrt?: unknown;
}

export interface ProgressiveCompileOptions {
    /**
     * Target the scene pass draws into (the post-FX scene pass). Defaults to
     * the target `renderer.render()` would use: Three's tone-mapping frame
     * buffer target, or the canvas.
     */
    target?: (() => CompileTarget | null) | null;
    chunkSize?: number;
    onProgress?: (compiled: number, total: number) => void;
    /** Checked between chunks; return true to stop early. A lost device also stops it. */
    shouldAbort?: () => boolean;
}

export interface ProgressiveCompileStats {
    objects: number;
    chunks: number;
    failedChunks: number;
    maxChunkMs: number;
    totalMs: number;
    aborted: boolean;
}

/** The slice of `WebGPURenderer` this module uses. */
export interface CompilingRenderer {
    compileAsync(scene: THREE.Object3D, camera: THREE.Camera): Promise<void>;
    getRenderTarget(): THREE.RenderTarget | null;
    setRenderTarget(target: THREE.RenderTarget | null): void;
    getMRT?(): unknown;
    setMRT?(mrt: unknown): unknown;
}

/** Internals read off the renderer (Three 0.171 `Renderer` / `WebGPUBackend`). */
function rendererDevice(renderer: CompilingRenderer): GPUDevice | null {
    return (renderer as { backend?: { device?: GPUDevice | null } }).backend?.device ?? null;
}

/** Set by Three (and gpu-context.ts) once the device or GL context is lost. */
function isRendererLost(renderer: CompilingRenderer): boolean {
    return (renderer as { _isDeviceLost?: boolean })._isDeviceLost === true;
}

/**
 * Three 0.171's `WebGPUPipelineUtils` wraps `createRenderPipelineAsync()` in a
 * promise that only resolves: if creation rejects (device lost, or a shader
 * the driver refuses), that promise never settles, `compileAsync()` hangs
 * forever and the rejection goes unhandled, which the bootstrap reports as a
 * fatal startup error. While a compile call is building, route a rejected
 * async creation to the synchronous `createRenderPipeline()`. That is what a
 * normal frame does: it returns an invalid pipeline and reports the error
 * through `uncapturederror` (or does nothing on a lost device), so the warmup
 * fails exactly like a first draw would, and keeps going.
 */
function guardAsyncPipelines(device: GPUDevice | null | undefined): () => void {
    if (!device || typeof device.createRenderPipelineAsync !== 'function') return () => {};
    const own = Object.prototype.hasOwnProperty.call(device, 'createRenderPipelineAsync');
    const original = device.createRenderPipelineAsync;
    device.createRenderPipelineAsync = (descriptor: GPURenderPipelineDescriptor) =>
        original.call(device, descriptor).catch(() => device.createRenderPipeline(descriptor));
    return () => {
        if (own) device.createRenderPipelineAsync = original;
        else delete (device as { createRenderPipelineAsync?: unknown }).createRenderPipelineAsync;
    };
}

type Renderable = THREE.Object3D & { frustumCulled: boolean };

function isRenderable(obj: THREE.Object3D): obj is Renderable {
    const o = obj as { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
    return Boolean(o.isMesh || o.isLine || o.isPoints || o.isSprite);
}

/**
 * Objects and lights a real frame through `camera` would project: visible
 * (with visible ancestors) and on one of the camera's layers.
 */
export function collectCompileSet(
    scene: THREE.Object3D,
    camera: THREE.Camera
): { objects: Renderable[]; lights: THREE.Object3D[] } {
    const objects: Renderable[] = [];
    const lights: THREE.Object3D[] = [];
    scene.traverseVisible((obj) => {
        if (!obj.layers.test(camera.layers)) return;
        if ((obj as { isLight?: boolean }).isLight) lights.push(obj);
        else if (isRenderable(obj)) objects.push(obj);
    });
    return { objects, lights };
}

function defaultTarget(renderer: CompilingRenderer): CompileTarget | null {
    // `render()` draws into this when tone mapping / an output color space is
    // active; compiling against the canvas would build pipelines for the wrong
    // color format.
    const fb = (
        renderer as { _getFrameBufferTarget?: () => THREE.RenderTarget | null }
    )._getFrameBufferTarget?.();
    return fb ? { renderTarget: fb } : null;
}

/**
 * Start compiling one chunk. The returned promise settles when the backend's
 * async pipeline creation finishes; all state is restored before this returns.
 */
export function compileChunk(
    renderer: CompilingRenderer,
    scene: THREE.Object3D,
    camera: THREE.Camera,
    chunk: readonly Renderable[],
    lights: readonly THREE.Object3D[],
    target: CompileTarget | null
): Promise<void> {
    const cameraMask = camera.layers.mask;
    const objectMasks = chunk.map((o) => o.layers.mask);
    const objectCulled = chunk.map((o) => o.frustumCulled);
    const lightMasks = lights.map((l) => l.layers.mask);
    const prevTarget = target ? renderer.getRenderTarget() : null;
    const prevMrt = target ? renderer.getMRT?.() : undefined;
    const restorePipelines = guardAsyncPipelines(rendererDevice(renderer));

    try {
        for (const o of chunk) {
            o.layers.enable(WARMUP_LAYER);
            // The frustum is whatever the last frame left; compile off-screen
            // objects too.
            o.frustumCulled = false;
        }
        for (const l of lights) l.layers.enable(WARMUP_LAYER);
        camera.layers.set(WARMUP_LAYER);
        if (target) {
            renderer.setRenderTarget(target.renderTarget);
            renderer.setMRT?.(target.mrt ?? null);
        }
        return renderer.compileAsync(scene, camera);
    } finally {
        restorePipelines();
        camera.layers.mask = cameraMask;
        for (let i = 0; i < chunk.length; i++) {
            chunk[i].layers.mask = objectMasks[i];
            chunk[i].frustumCulled = objectCulled[i];
        }
        for (let i = 0; i < lights.length; i++) lights[i].layers.mask = lightMasks[i];
        if (target) {
            renderer.setRenderTarget(prevTarget);
            renderer.setMRT?.(prevMrt ?? null);
        }
    }
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Compile every object a frame of `scene` through `camera` would draw, in
 * chunks, yielding between them. Failures are logged and skipped: an object
 * that fails here fails (or compiles) on first draw exactly as before.
 */
export async function compileSceneProgressively(
    renderer: CompilingRenderer,
    scene: THREE.Object3D,
    camera: THREE.Camera,
    options: ProgressiveCompileOptions = {}
): Promise<ProgressiveCompileStats> {
    const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
    const start = performance.now();
    const { objects, lights } = collectCompileSet(scene, camera);
    const stats: ProgressiveCompileStats = {
        objects: objects.length,
        chunks: 0,
        failedChunks: 0,
        maxChunkMs: 0,
        totalMs: 0,
        aborted: false,
    };

    for (let i = 0; i < objects.length; i += chunkSize) {
        // A lost device makes every later chunk a no-op (Three returns early).
        if (isRendererLost(renderer) || options.shouldAbort?.()) {
            stats.aborted = true;
            break;
        }
        const chunkStart = performance.now();
        const target = options.target ? options.target() : defaultTarget(renderer);
        try {
            await compileChunk(
                renderer,
                scene,
                camera,
                objects.slice(i, i + chunkSize),
                lights,
                target
            );
        } catch (err) {
            stats.failedChunks++;
            console.warn('[ShaderWarmup] compileAsync failed for a chunk (non-fatal):', err);
        }
        stats.chunks++;
        stats.maxChunkMs = Math.max(stats.maxChunkMs, performance.now() - chunkStart);
        options.onProgress?.(Math.min(i + chunkSize, objects.length), objects.length);
        await yieldToEventLoop();
    }

    stats.totalMs = performance.now() - start;
    return stats;
}
