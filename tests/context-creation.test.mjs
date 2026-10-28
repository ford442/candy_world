/**
 * Context-creation pieces of #1972 that run without a browser: the reload
 * banner on device / WebGL context loss, uncaptured-error bookkeeping, the
 * tier-scaled pixel ratio and its DPR re-application, progressive
 * `compileAsync` warmup, and the timestamp-query GPU frame timer.
 *
 * Run: npm run test:context-creation
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';

// --- Minimal browser surface, installed before importing the modules -------
const listeners = new Map();
const mediaQueries = [];
let devicePixelRatio = 2;
globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    get devicePixelRatio() {
        return devicePixelRatio;
    },
    location: { search: '', reload() {} },
    addEventListener(type, fn) {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener(type, fn) {
        listeners.set(
            type,
            (listeners.get(type) ?? []).filter((f) => f !== fn)
        );
    },
    matchMedia(query) {
        const mql = new EventTarget();
        mql.media = query;
        mql.matches = true;
        mediaQueries.push(mql);
        return mql;
    },
};
const appended = [];
globalThis.document = {
    body: { appendChild: (el) => appended.push(el) },
    getElementById: (id) => appended.find((el) => el.id === id) ?? null,
    createElement: (tag) => ({
        tag,
        style: {},
        children: [],
        attributes: {},
        setAttribute(k, v) {
            this.attributes[k] = v;
        },
        appendChild(child) {
            this.children.push(child);
        },
        addEventListener() {},
    }),
};

const gpu = await import('../src/rendering/gpu-context.ts');
const { resolveMaxPixelRatio, resolvePlatformCapabilities } =
    await import('../src/core/platform/capabilities.ts');
const viewport = await import('../src/rendering/viewport.ts');
const warmup = await import('../src/rendering/shader-warmup.ts');
const timer = await import('../src/rendering/gpu-frame-timer.ts');
const hitches = await import('../src/rendering/frame-hitches.ts');

const quiet = async (fn) => {
    const warn = console.warn;
    console.warn = () => {};
    try {
        return await fn();
    } finally {
        console.warn = warn;
    }
};

// --- WebGL2 context loss ends at the reload banner when it cannot recover --
// (Recovery itself is covered by tests/device-recovery.test.mjs; this renderer
// has no backend to rebuild, and the context is never restored.)
await quiet(async () => {
    gpu.__resetGpuContextForTests();
    gpu.__setRecoveryTimingForTests({ retryMs: 0, restoreTimeoutMs: 20 });
    gpu.settleWebGLContext('explicit-webgl');
    const canvas = new EventTarget();
    const renderer = {};
    gpu.watchWebGLContextLoss(renderer, canvas);

    let heard = null;
    gpu.onGpuDeviceLost((reason) => (heard = reason));

    // Three's backend reports loss through renderer.onDeviceLost …
    renderer.onDeviceLost({ message: 'GPU reset' });
    assert.equal(
        renderer._isDeviceLost,
        true,
        'render(), compute() and compileAsync() stop, as with Three’s own handler'
    );
    assert.equal(heard, 'GPU reset');
    assert.equal(window.__gpuContext.lost, true);
    assert.equal(window.__gpuContext.backend, 'webgl');
    assert.equal(document.getElementById('gpu-device-lost-banner'), null, 'recovery first');
    assert.equal(await gpu.whenGraphicsRecovered(), false);

    const banner = document.getElementById('gpu-device-lost-banner');
    assert.ok(banner, 'banner shown');
    assert.match(banner.children[0].textContent, /^Graphics stopped/);
    assert.doesNotMatch(banner.children[0].textContent, /effects reduced/);
    assert.equal(banner.children[1].textContent, 'Reload');

    // … and the raw canvas event is idempotent with it.
    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    assert.equal(lost.defaultPrevented, true, 'context loss is cancelled so restore can fire');
    assert.equal(appended.filter((el) => el.id === 'gpu-device-lost-banner').length, 1);

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    assert.equal(window.__gpuContext.contextRestored, true);
    assert.equal(window.__gpuContext.lost, true, 'a late restore after giving up changes nothing');
});

// --- Uncaptured WebGPU errors are recorded on window.__gpuContext ----------
await quiet(async () => {
    gpu.__resetGpuContextForTests();
    class GPUValidationError {
        constructor(message) {
            this.message = message;
        }
    }
    for (let i = 0; i < 25; i++)
        gpu.recordGpuError(new GPUValidationError(`bad bind group ${i}`), i);
    const { errors } = window.__gpuContext;
    assert.equal(errors.count, 25);
    assert.equal(errors.recent.length, 20, 'history is bounded');
    assert.deepEqual(errors.recent.at(-1), {
        type: 'validation',
        message: 'bad bind group 24',
        at: 24,
    });
    assert.equal(gpu.recordGpuError('plain').type, 'unknown');
});

// --- Pixel ratio: tier-scaled cap, re-applied on DPR change ----------------
{
    assert.equal(resolveMaxPixelRatio('low', 'webgpu'), 1);
    assert.equal(resolveMaxPixelRatio('medium', 'webgpu'), 1.25);
    assert.equal(resolveMaxPixelRatio('high', 'webgpu'), 1.5);
    assert.equal(resolveMaxPixelRatio('high', 'webgl2'), 1, 'WebGL2 is always 1');

    const caps = (o) =>
        resolvePlatformCapabilities({
            runMode: 'player',
            backend: 'webgpu',
            fallbackAdapter: false,
            gpuPrefersLite: false,
            deviceMemoryGB: undefined,
            timestampQuery: false,
            displayHdr: false,
            extendedRange: false,
            graphicsOverride: null,
            ...o,
        });
    assert.equal(caps({}).maxPixelRatio, 1.5);
    assert.equal(caps({ deviceMemoryGB: 8 }).maxPixelRatio, 1.25, 'Chrome caps deviceMemory at 8');
    assert.equal(caps({ deviceMemoryGB: 4 }).maxPixelRatio, 1);
    assert.equal(caps({ backend: 'webgl2', graphicsOverride: 'high' }).maxPixelRatio, 1);

    assert.equal(viewport.resolvePixelRatio(3, 1.5), 1.5);
    assert.equal(viewport.resolvePixelRatio(1, 1.5), 1);
    assert.equal(viewport.resolvePixelRatio(NaN, 1.5), 1);
    assert.equal(viewport.devicePixelRatioQuery(1.25), '(resolution: 1.25dppx)');

    const calls = [];
    const renderer = {
        ratio: 1,
        getPixelRatio() {
            return this.ratio;
        },
        setPixelRatio(r) {
            this.ratio = r;
            calls.push(['ratio', r]);
        },
        setSize(w, h) {
            calls.push(['size', w, h]);
        },
    };
    const camera = new THREE.PerspectiveCamera();
    let postFx = 0;
    viewport.onViewportResize(() => postFx++);

    viewport.installViewport(renderer, camera, 1.5);
    assert.equal(renderer.ratio, 1.5, 'DPR 2 is capped to 1.5');
    assert.deepEqual(calls.at(-1), ['size', 1280, 720]);
    assert.equal(camera.aspect, 1280 / 720);
    assert.equal(postFx, 1);
    assert.equal(listeners.get('resize').length, 1, 'one resize listener for everything');
    assert.equal(mediaQueries.at(-1).media, '(resolution: 2dppx)');

    // Window resize.
    window.innerWidth = 800;
    window.innerHeight = 800;
    listeners.get('resize')[0]();
    assert.equal(camera.aspect, 1);
    assert.equal(postFx, 2);

    // Dragged to a 1× monitor: the old query fires, ratio follows, query re-arms.
    devicePixelRatio = 1;
    mediaQueries.at(-1).dispatchEvent(new Event('change'));
    assert.equal(renderer.ratio, 1);
    assert.equal(mediaQueries.at(-1).media, '(resolution: 1dppx)');
    assert.equal(postFx, 3);

    // A DPR change that only surfaces as a resize still re-arms the query.
    devicePixelRatio = 3;
    listeners.get('resize')[0]();
    assert.equal(renderer.ratio, 1.5);
    assert.equal(mediaQueries.at(-1).media, '(resolution: 3dppx)');

    // Installing again (hot reload) does not stack listeners.
    viewport.installViewport(renderer, camera, 1);
    assert.equal(listeners.get('resize').length, 1);
    viewport.__resetViewportForTests();
    assert.equal(listeners.get('resize').length, 0);
}

// --- Progressive compileAsync warmup ---------------------------------------
{
    const scene = new THREE.Scene();
    const light = new THREE.DirectionalLight();
    const hiddenLight = new THREE.PointLight();
    hiddenLight.layers.set(5); // not on the camera's layers
    scene.add(light, hiddenLight);
    const geo = new THREE.BoxGeometry();
    const mat = new THREE.MeshBasicMaterial();
    const meshes = Array.from({ length: 5 }, () => new THREE.Mesh(geo, mat));
    const group = new THREE.Group();
    group.add(...meshes);
    scene.add(group);
    const hidden = new THREE.Mesh(geo, mat);
    hidden.visible = false;
    scene.add(hidden);
    const otherLayer = new THREE.Mesh(geo, mat);
    otherLayer.layers.set(3);
    scene.add(otherLayer);
    const camera = new THREE.PerspectiveCamera();
    camera.layers.enable(2);
    const cameraMask = camera.layers.mask;

    const set = warmup.collectCompileSet(scene, camera);
    assert.deepEqual(set.objects, meshes, 'visible, on-layer renderables only');
    assert.deepEqual(set.lights, [light]);

    const realTarget = new THREE.RenderTarget(1, 1);
    const passTarget = new THREE.RenderTarget(1, 1);
    const seen = [];
    let renderer = {
        target: realTarget,
        mrt: 'frame-mrt',
        getRenderTarget() {
            return this.target;
        },
        setRenderTarget(t) {
            this.target = t;
        },
        getMRT() {
            return this.mrt;
        },
        setMRT(m) {
            this.mrt = m;
        },
        async compileAsync(root, cam) {
            assert.equal(root, scene, 'the scene stays the root (fog, env, lights)');
            // What Three's _projectObject would push: visible + layer test.
            const projected = [];
            const lightsSeen = [];
            root.traverseVisible((o) => {
                if (!o.layers.test(cam.layers)) return;
                if (o.isLight) lightsSeen.push(o);
                else if (o.isMesh) projected.push(o);
            });
            assert.deepEqual(lightsSeen, [light], 'the frame’s lights, every chunk');
            assert.ok(projected.every((o) => o.frustumCulled === false));
            seen.push({ projected, target: this.target, mrt: this.mrt });
        },
    };

    let progress = [];
    const stats = await warmup.compileSceneProgressively(renderer, scene, camera, {
        chunkSize: 2,
        target: () => ({ renderTarget: passTarget, mrt: 'pass-mrt' }),
        onProgress: (done, total) => progress.push([done, total]),
    });
    assert.equal(stats.objects, 5);
    assert.equal(stats.chunks, 3);
    assert.equal(stats.failedChunks, 0);
    assert.deepEqual(
        seen.map((s) => s.projected),
        [meshes.slice(0, 2), meshes.slice(2, 4), meshes.slice(4)]
    );
    assert.ok(seen.every((s) => s.target === passTarget && s.mrt === 'pass-mrt'));
    assert.deepEqual(progress, [
        [2, 5],
        [4, 5],
        [5, 5],
    ]);

    // Everything is restored.
    assert.equal(camera.layers.mask, cameraMask);
    assert.ok(meshes.every((m) => m.frustumCulled && m.layers.mask === 1));
    assert.equal(light.layers.mask, 1);
    assert.equal(renderer.target, realTarget);
    assert.equal(renderer.mrt, 'frame-mrt');

    // Each object compiles once per renderer: a second pass (the deferred
    // warmup after boot's) skips them, and a swapped material compiles again.
    seen.length = 0;
    const again = await warmup.compileSceneProgressively(renderer, scene, camera, {
        target: () => ({ renderTarget: passTarget, mrt: 'pass-mrt' }),
    });
    assert.equal(again.objects, 0);
    assert.equal(again.alreadyCompiled, 5);
    assert.equal(seen.length, 0, 'nothing left to compile');
    meshes[3].material = new THREE.MeshBasicMaterial();
    const swapped = await warmup.compileSceneProgressively(renderer, scene, camera, {
        target: () => ({ renderTarget: passTarget, mrt: 'pass-mrt' }),
    });
    assert.equal(swapped.objects, 1);
    assert.deepEqual(seen.at(-1).projected, [meshes[3]]);
    meshes[3].material = mat;
    // So does a material changed in place and flagged for a rebuild.
    await warmup.compileSceneProgressively(renderer, scene, camera, {
        target: () => ({ renderTarget: passTarget, mrt: 'pass-mrt' }),
    });
    mat.needsUpdate = true;
    const changed = await warmup.compileSceneProgressively(renderer, scene, camera, {
        target: () => ({ renderTarget: passTarget, mrt: 'pass-mrt' }),
    });
    assert.equal(changed.objects, 5, 'needsUpdate on a shared material recompiles its users');
    // Device-loss recovery rebuilds the renderer in place on a new backend,
    // which has compiled nothing: the cache is per backend, not per renderer.
    renderer.backend = { rebuilt: true };
    const rebuilt = await warmup.compileSceneProgressively(renderer, scene, camera, {
        target: () => ({ renderTarget: passTarget, mrt: 'pass-mrt' }),
    });
    assert.equal(rebuilt.objects, 5, 'a rebuilt backend compiles everything again');
    delete renderer.backend;

    // A throwing chunk is restored and skipped; abort stops between chunks.
    // A fresh renderer has compiled nothing yet.
    renderer = { ...renderer };
    let n = 0;
    renderer.compileAsync = () => {
        if (n++ === 0) throw new Error('boom');
        return Promise.resolve();
    };
    const failed = await quiet(() =>
        warmup.compileSceneProgressively(renderer, scene, camera, {
            chunkSize: 2,
            shouldAbort: () => n >= 2,
        })
    );
    assert.equal(failed.failedChunks, 1);
    assert.equal(failed.aborted, true);
    assert.equal(failed.chunks, 2);
    assert.equal(camera.layers.mask, cameraMask);
    assert.ok(meshes.every((m) => m.frustumCulled && m.layers.mask === 1));
}

// --- A lost renderer stops the warmup before compiling anything -----------
{
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    const camera = new THREE.PerspectiveCamera();
    let called = 0;
    const renderer = {
        _isDeviceLost: true,
        getRenderTarget: () => null,
        setRenderTarget() {},
        compileAsync: async () => void called++,
    };
    const lost = await warmup.compileSceneProgressively(renderer, scene, camera);
    assert.equal(called, 0);
    assert.equal(lost.aborted, true);
}

// --- GPU frame timer resolves Three's timestamp pools -------------------------
{
    const noop = timer.createGpuFrameTimer({ backend: { trackTimestamp: false } }, () => {
        throw new Error('must not report');
    });
    for (let i = 0; i < 60; i++) noop.endFrame();

    const resolved = [];
    let release;
    const renderer = {
        backend: { trackTimestamp: true },
        resolveTimestampsAsync(type) {
            resolved.push(type);
            return type === 'render'
                ? new Promise((r) => (release = () => r(2.5)))
                : Promise.resolve(1);
        },
    };
    const reports = [];
    const t = timer.createGpuFrameTimer(renderer, (ms) => reports.push(ms));
    for (let f = 1; f < timer.SAMPLE_INTERVAL_FRAMES; f++) t.endFrame();
    assert.deepEqual(resolved, [], 'nothing resolved before the interval');
    t.endFrame();
    assert.deepEqual(resolved, ['render', 'compute']);
    // One resolve in flight at a time: the next interval is skipped.
    for (let f = 0; f < timer.SAMPLE_INTERVAL_FRAMES; f++) t.endFrame();
    assert.equal(resolved.length, 2);
    release();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(reports, [3.5], 'render + compute GPU ms of the last frame');
}

// --- First-30 s frame hitch counter ----------------------------------------
{
    let done = null;
    const c = hitches.createFrameHitchCounter((r) => (done = { ...r }));
    // First frame: 120 ms of work (a cold pipeline), then 16 ms frames with
    // one 60 ms and one 140 ms interval.
    let t = 1000;
    c.beginFrame(t);
    c.endFrame(t + 120);
    t += 125;
    const intervals = [16, 60, 16, 140, 16];
    for (const dt of intervals) {
        c.beginFrame(t);
        c.endFrame(t + 4);
        t += dt;
    }
    const r = c.report();
    assert.equal(r.firstFrameMs, 120);
    assert.equal(r.frames, 1 + intervals.length);
    assert.equal(r.over50, 3, 'the 125 ms first interval, 60 ms and 140 ms');
    assert.equal(r.over100, 2);
    assert.equal(r.worstMs, 140);
    assert.equal(r.done, false);
    assert.equal(done, null);

    // The window closes once, and the numbers freeze.
    c.beginFrame(1000 + hitches.HITCH_WINDOW_MS);
    assert.equal(c.report().done, true);
    assert.equal(done.frames, r.frames);
    c.beginFrame(1000 + hitches.HITCH_WINDOW_MS + 500);
    assert.equal(c.report().frames, done.frames, 'frozen after the window');
}

console.log('context-creation: all assertions passed');
