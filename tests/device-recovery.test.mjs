/**
 * Device-loss recovery (#2025 slice E), without a browser: the in-place
 * renderer rebuild in `device-recovery.ts`, and the policy around it in
 * `gpu-context.ts` (what is recoverable, two attempts, the banner only after
 * both fail, the loss-storm guard, `?debug_lose_device`, WebGL2 restore).
 *
 * Run: npm run test:device-recovery
 */
import assert from 'node:assert/strict';

// --- Minimal browser surface, installed before importing the modules -------
const appended = [];
globalThis.window = { location: { search: '' } };
globalThis.document = {
    body: { appendChild: (el) => appended.push(el) },
    getElementById: (id) => appended.find((el) => el.id === id) ?? null,
    createElement: (tag) => ({
        tag,
        style: {},
        children: [],
        setAttribute() {},
        appendChild(child) {
            this.children.push(child);
        },
        addEventListener() {},
    }),
};
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 0x10, COPY_SRC: 0x01 };

const rec = await import('../src/rendering/device-recovery.ts');
const gpu = await import('../src/rendering/gpu-context.ts');

const quiet = async (fn) => {
    const warn = console.warn;
    const log = console.log;
    console.warn = () => {};
    console.log = () => {};
    try {
        return await fn();
    } finally {
        console.warn = warn;
        console.log = log;
    }
};
const bannerShown = () => appended.some((el) => el.id === 'gpu-device-lost-banner');

// --- Fakes: devices, adapter, canvas, and a renderer shaped like three's -----
function makeDevice(name) {
    let resolveLost;
    const lost = new Promise((r) => (resolveLost = r));
    return {
        name,
        destroyed: false,
        limits: { maxStorageBufferBindingSize: 134217728 },
        features: new Set(),
        lost,
        lose(reason, message = `${name} lost`) {
            resolveLost({ reason, message });
        },
        destroy() {
            this.destroyed = true;
            resolveLost({ reason: 'destroyed', message: 'Device was destroyed.' });
        },
        pushErrorScope() {},
        popErrorScope: async () => null,
        createShaderModule: () => ({}),
        createComputePipelineAsync: async () => ({}),
    };
}

/** `navigator.gpu` handing out `devices` in order; null once they run out. */
function installGpu(devices) {
    const queue = [...devices];
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        writable: true,
        value: {
            userAgent: 'Mozilla/5.0 Chrome/141.0.0.0',
            gpu: {
                getPreferredCanvasFormat: () => 'bgra8unorm',
                requestAdapter: async () => {
                    const device = queue.shift();
                    if (!device) return null;
                    return {
                        features: new Set(),
                        info: {
                            vendor: 'fake',
                            architecture: '',
                            device: 'FakeGPU',
                            description: '',
                        },
                        isFallbackAdapter: false,
                        requestDevice: async () => device,
                    };
                },
            },
        },
    });
}

function makeCanvas() {
    const canvas = new EventTarget();
    canvas.webgpuContext = { configure() {} };
    canvas.getContext = (kind) => (kind === 'webgpu' ? canvas.webgpuContext : null);
    return canvas;
}

function makeAnimation() {
    return {
        loop: null,
        stopped: false,
        getAnimationLoop() {
            return this.loop;
        },
        setAnimationLoop(cb) {
            this.loop = cb;
        },
        stop() {
            this.stopped = true;
        },
    };
}

class FakeWebGPUBackend {
    static failInits = 0;
    constructor(parameters) {
        this.parameters = { ...parameters };
        this.isWebGPUBackend = true;
    }
    async init() {
        if (FakeWebGPUBackend.failInits > 0) {
            FakeWebGPUBackend.failInits--;
            throw new Error('backend init failed');
        }
        this.device = this.parameters.device;
    }
}

class FakeWebGLBackend {
    constructor(parameters) {
        this.parameters = { ...parameters };
        this.isWebGLBackend = true;
        this._onContextLost = () => {};
    }
    async init(renderer) {
        renderer.domElement.addEventListener('webglcontextlost', this._onContextLost);
    }
}

function makeRenderer(Backend, parameters, canvas) {
    return {
        isWebGPURenderer: true,
        backend: new Backend(parameters),
        domElement: canvas,
        outputColorSpace: 'srgb',
        _initialized: false,
        _initPromise: null,
        _isDeviceLost: false,
        _getFallback: () => {
            throw new Error('fallback must be off during recovery');
        },
        _animation: null,
        inits: 0,
        hasInitialized() {
            return this._initialized;
        },
        init() {
            if (this._initPromise) return this._initPromise;
            this._initPromise = (async () => {
                await this.backend.init(this);
                this._animation = makeAnimation();
                this._initialized = true;
                this.inits++;
            })();
            return this._initPromise;
        },
        setAnimationLoop(cb) {
            this._animation.setAnimationLoop(cb);
        },
    };
}

async function bootWebGPU(devices) {
    gpu.__resetGpuContextForTests();
    gpu.__setRecoveryTimingForTests({ retryMs: 0, restoreTimeoutMs: 50 });
    appended.length = 0;
    installGpu(devices);
    const canvas = makeCanvas();
    const probe = await gpu.probeWebGPU(canvas);
    const renderer = makeRenderer(
        FakeWebGPUBackend,
        { device: probe.device, context: probe.context, trackTimestamp: true },
        canvas
    );
    await gpu.armGpuContext(renderer, probe);
    const loop = () => {};
    renderer.setAnimationLoop(loop);
    return { renderer, probe, loop };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// --- device-recovery.ts: the pure pieces ------------------------------------
{
    let calls = 0;
    const ok = await rec.retry(
        async () => {
            if (++calls < 2) throw new Error('not yet');
        },
        2,
        0
    );
    assert.deepEqual([ok.ok, ok.attempts, ok.errors.length], [true, 2, 1]);

    const fail = await rec.retry(
        async () => {
            throw new Error('never');
        },
        2,
        0
    );
    assert.deepEqual([fail.ok, fail.attempts, fail.errors.length], [false, 2, 2]);

    assert.equal(rec.isLossStorm([], 1000, 3, 60_000), false);
    assert.equal(rec.isLossStorm([10, 20], 1000, 3, 60_000), false);
    assert.equal(rec.isLossStorm([10, 20, 30], 1000, 3, 60_000), true);
    assert.equal(rec.isLossStorm([10, 20, 30], 70_000, 3, 60_000), false, 'old recoveries age out');
}

// --- reinitRenderer: new backend, same renderer object, fallback off --------
{
    const canvas = makeCanvas();
    const renderer = makeRenderer(FakeWebGLBackend, { forceWebGL: true }, canvas);
    await renderer.init();
    const deadBackend = renderer.backend;
    const fallback = renderer._getFallback;
    const removed = [];
    canvas.removeEventListener = (type, fn) => removed.push([type, fn]);
    const oldAnimation = renderer._animation;
    renderer.setAnimationLoop(() => {});

    const recipe = rec.captureBackendRecipe(renderer);
    const loop = rec.pauseFrames(renderer);
    assert.equal(typeof loop, 'function');
    assert.equal(oldAnimation.loop, null, 'paused: three ticks with no callback');

    await rec.reinitRenderer(renderer, recipe);
    assert.notEqual(renderer.backend, deadBackend, 'a fresh backend');
    assert.ok(renderer.backend instanceof FakeWebGLBackend);
    assert.deepEqual(renderer.backend.parameters, { forceWebGL: true });
    assert.equal(renderer.inits, 2, 'init() ran again on the same object');
    assert.equal(oldAnimation.stopped, true, "the dead animation's rAF is cancelled");
    assert.deepEqual(removed, [['webglcontextlost', deadBackend._onContextLost]]);
    assert.equal(renderer._getFallback, fallback, 'fallback restored after the call');

    rec.resumeFrames(renderer, loop);
    assert.equal(renderer._animation.getAnimationLoop(), loop);
    assert.notEqual(renderer._animation, oldAnimation);
}

// --- WebGPU: a fault rebuilds on a new device; no banner --------------------
await quiet(async () => {
    const first = makeDevice('first');
    const second = makeDevice('second');
    const { renderer, loop } = await bootWebGPU([first, second]);

    let atLoss = null;
    let restoredHeard = 0;
    gpu.onGpuDeviceLost(() => {
        atLoss = {
            lost: window.__gpuContext.lost,
            recovering: window.__gpuContext.recovering,
            stopped: renderer._isDeviceLost,
            frames: renderer._animation.getAnimationLoop(),
        };
    });
    gpu.onGpuDeviceRestored(() => restoredHeard++);

    first.lose('unknown', 'GPU process crashed');
    await tick();
    // CPU tiers hear the loss first, with rendering already stopped; the
    // frame loop is paused by the recovery right after.
    assert.deepEqual(atLoss, { lost: true, recovering: true, stopped: true, frames: loop });

    assert.equal(await gpu.whenGraphicsRecovered(), true);
    assert.equal(window.__gpuContext.lost, false);
    assert.equal(window.__gpuContext.recovering, false);
    assert.equal(window.__gpuContext.recoveries, 1);
    assert.equal(restoredHeard, 1);
    assert.equal(bannerShown(), false, 'no banner when recovery works');
    assert.equal(renderer._isDeviceLost, false);
    assert.equal(renderer.backend.device, second, 'the renderer draws with the new device');
    assert.equal(renderer.backend.parameters.trackTimestamp, true, 'other parameters kept');
    assert.equal(renderer._animation.getAnimationLoop(), loop, 'frames resume');
    assert.equal(await gpu.awaitGpuDevice(), second, 'compute adopts the new device');
    assert.equal(gpu.getGpuContextSync().device, second);

    // The new device is watched as well.
    second.lose('unknown');
    await tick();
    assert.equal(await gpu.whenGraphicsRecovered(), false, 'no third device: both attempts fail');
    assert.equal(window.__gpuContext.lost, true);
    assert.equal(window.__gpuContext.recovering, false);
    assert.equal(bannerShown(), true, 'banner after two failed attempts');
});

// --- WebGPU: one failed attempt is retried ----------------------------------
await quiet(async () => {
    const first = makeDevice('first');
    const { renderer } = await bootWebGPU([first, makeDevice('bad'), makeDevice('good')]);
    FakeWebGPUBackend.failInits = 1;
    first.lose('unknown');
    await tick();
    assert.equal(await gpu.whenGraphicsRecovered(), true);
    assert.equal(renderer.backend.device.name, 'good');
    assert.equal(bannerShown(), false);
});

// --- WebGPU: `destroyed` is not a fault, unless ?debug_lose_device did it ----
await quiet(async () => {
    const first = makeDevice('first');
    await bootWebGPU([first, makeDevice('second')]);
    first.destroy();
    await tick();
    assert.equal(window.__gpuContext.lost, true);
    assert.equal(window.__gpuContext.recovering, false, 'a real destroy is not retried');
    assert.equal(bannerShown(), true);
});
await quiet(async () => {
    const first = makeDevice('first');
    const { renderer } = await bootWebGPU([first, makeDevice('second')]);
    await gpu.loseGpuDeviceForDebug();
    assert.equal(first.destroyed, true, 'the debug hook calls device.destroy()');
    await tick();
    assert.equal(await gpu.whenGraphicsRecovered(), true, 'its destroy is recoverable');
    assert.equal(renderer.backend.device.name, 'second');
    assert.equal(bannerShown(), false);
});

// --- WebGPU: losses that keep coming back go to the banner ------------------
await quiet(async () => {
    const devices = Array.from({ length: 6 }, (_, i) => makeDevice(`d${i}`));
    await bootWebGPU(devices);
    for (let i = 0; i < 3; i++) {
        devices[i].lose('unknown');
        await tick();
        assert.equal(await gpu.whenGraphicsRecovered(), true, `recovery ${i + 1}`);
    }
    devices[3].lose('unknown');
    await tick();
    assert.equal(await gpu.whenGraphicsRecovered(), false, 'fourth loss in a minute: give up');
    assert.equal(bannerShown(), true);
});

// --- WebGL2: rebuilt on the restored context --------------------------------
await quiet(async () => {
    gpu.__resetGpuContextForTests();
    gpu.__setRecoveryTimingForTests({ retryMs: 0, restoreTimeoutMs: 200 });
    appended.length = 0;
    gpu.settleWebGLContext('explicit-webgl');
    const canvas = makeCanvas();
    const renderer = makeRenderer(FakeWebGLBackend, { forceWebGL: true }, canvas);
    await renderer.init();
    gpu.watchWebGLContextLoss(renderer, canvas);
    const loop = () => {};
    renderer.setAnimationLoop(loop);
    const deadBackend = renderer.backend;

    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    assert.equal(lost.defaultPrevented, true, 'cancelled, so the browser may restore it');
    assert.equal(window.__gpuContext.lost, true);
    assert.equal(bannerShown(), false, 'waiting for the restore, not giving up');

    await tick();
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    assert.equal(await gpu.whenGraphicsRecovered(), true);
    assert.equal(window.__gpuContext.lost, false);
    assert.equal(window.__gpuContext.backend, 'webgl');
    assert.notEqual(renderer.backend, deadBackend);
    assert.equal(renderer._animation.getAnimationLoop(), loop);
    assert.equal(bannerShown(), false);
});

// --- WebGL2: a context that never comes back ends at the banner -------------
await quiet(async () => {
    gpu.__resetGpuContextForTests();
    gpu.__setRecoveryTimingForTests({ retryMs: 0, restoreTimeoutMs: 20 });
    appended.length = 0;
    gpu.settleWebGLContext('explicit-webgl');
    const canvas = makeCanvas();
    const renderer = makeRenderer(FakeWebGLBackend, {}, canvas);
    await renderer.init();
    gpu.watchWebGLContextLoss(renderer, canvas);
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    assert.equal(await gpu.whenGraphicsRecovered(), false);
    assert.equal(bannerShown(), true);
    assert.match(
        appended.find((el) => el.id === 'gpu-device-lost-banner').children[0].textContent,
        /^Graphics stopped/
    );
});

console.log('device-recovery: all assertions passed');
