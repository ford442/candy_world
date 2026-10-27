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
 * Once per object: the boot pass compiles the scene that exists before world
 * generation and the deferred pass the generated world. Each renderer
 * remembers which objects it compiled, with which material, so the deferred
 * pass skips what boot already built and only a swapped material compiles again.
 *
 * Progressive: `compileAsync(scene, camera)` would project and build the whole
 * scene in one synchronous task. Instead each call sees one chunk of objects
 * through a spare camera layer ({@link WARMUP_LAYER}), and the event loop gets
 * a turn between chunks. The scene itself is still the root, so fog, the
 * environment and the full light list match a real frame and the compiled
 * programs are the ones the frame will use. Layers, culling flags and the
 * render target are swapped and restored synchronously around each call:
 * Three projects the chunk and fixes its render context before its first
 * `await`, and no frame can run in between, so a running game loop never sees
 * the swapped state. The node builds themselves run on after that (r186
 * yields between shader stages) and read `renderer.getMRT()` when they get to
 * the material's setup, so an MRT target cannot be warmed this way: the post
 * graph offers no target under TRAA.
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
    /** Visible objects skipped because this renderer already compiled them. */
    alreadyCompiled: number;
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

/**
 * Set by Three (and gpu-context.ts) once the device or GL context is lost.
 * A rejected async pipeline no longer needs handling here: Three (r172+)
 * always settles `compileAsync()`, logging and marking the failed pipeline,
 * where 0.171 left it pending forever.
 */
function isRendererLost(renderer: CompilingRenderer): boolean {
    return (renderer as { _isDeviceLost?: boolean })._isDeviceLost === true;
}

type Renderable = THREE.Object3D & { frustumCulled: boolean; material?: unknown };

/** Per renderer: each compiled object and the {@link compileKey} it was compiled with. */
const compiledByRenderer = new WeakMap<object, WeakMap<THREE.Object3D, string>>();

/**
 * What an object was compiled with: its material(s) and their versions, so a
 * swapped material, or one changed and flagged `needsUpdate`, compiles again.
 */
function compileKey(o: Renderable): string {
    const material = o.material as THREE.Material | THREE.Material[] | undefined;
    const materials = Array.isArray(material) ? material : [material];
    return materials.map((m) => (m ? `${m.uuid}:${m.version}` : '-')).join('|');
}

function compiledFor(renderer: CompilingRenderer): WeakMap<THREE.Object3D, string> {
    let compiled = compiledByRenderer.get(renderer);
    if (!compiled) {
        compiled = new WeakMap();
        compiledByRenderer.set(renderer, compiled);
    }
    return compiled;
}

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
    const visible = collectCompileSet(scene, camera);
    const compiled = compiledFor(renderer);
    const objects = visible.objects.filter((o) => compiled.get(o) !== compileKey(o));
    const { lights } = visible;
    const stats: ProgressiveCompileStats = {
        objects: objects.length,
        alreadyCompiled: visible.objects.length - objects.length,
        chunks: 0,
        failedChunks: 0,
        maxChunkMs: 0,
        totalMs: 0,
        aborted: isRendererLost(renderer),
    };

    for (let i = 0; i < objects.length && !stats.aborted; i += chunkSize) {
        // A lost device makes every later chunk a no-op (Three returns early).
        if (isRendererLost(renderer) || options.shouldAbort?.()) {
            stats.aborted = true;
            break;
        }
        const chunkStart = performance.now();
        const target = options.target ? options.target() : defaultTarget(renderer);
        const chunk = objects.slice(i, i + chunkSize);
        try {
            await compileChunk(renderer, scene, camera, chunk, lights, target);
            for (const o of chunk) compiled.set(o, compileKey(o));
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
