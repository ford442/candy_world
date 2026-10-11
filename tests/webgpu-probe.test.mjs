/**
 * Unit tests for the WebGPU boot probe and the WebGL2 fallback bookkeeping.
 *
 * The contract under test: `probeWebGPU()` is the only adapter/device request,
 * it fails at a *named* stage, and it never hands back a half-built device that
 * a caller could mistake for a working one. When it fails, the context records
 * the WebGL2 fallback without losing that stage.
 *
 * Run: npm run test:webgpu-probe
 */
import assert from 'node:assert/strict';

// --- Minimal browser surface, installed before importing the module ---------
globalThis.window = globalThis.window ?? {};
globalThis.document = globalThis.document ?? { getElementById: () => null };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 0x10, COPY_SRC: 0x01 };

// Node 24 exposes `navigator` as a getter-only global, so it has to be
// redefined rather than assigned.
function setNavigator(value) {
    Object.defineProperty(globalThis, 'navigator', {
        value,
        configurable: true,
        writable: true,
    });
}

const {
    probeWebGPU,
    WebGPUUnavailableError,
    __resetGpuContextForTests,
    getWebGPUProbeReport,
    applyCanvasColorSpace,
    resolveRequiredLimits,
    GPU_REQUIRED_LIMITS,
    settleWebGLContext,
    getGpuContextSync,
    awaitGpuDevice,
} = await import('../src/rendering/gpu-context.ts');
const { resolveRendererBackend } = await import('../src/rendering/renderer-mode.ts');

// --- Fakes -----------------------------------------------------------------

function makeDevice(overrides = {}) {
    return {
        destroyed: false,
        limits: { maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupSizeX: 256 },
        features: new Set(),
        lost: new Promise(() => {}),
        adapterInfo: {
            vendor: 'fake',
            architecture: 'discrete',
            device: 'FakeGPU',
            description: '',
        },
        destroy() {
            this.destroyed = true;
        },
        pushErrorScope() {},
        popErrorScope: async () => null,
        createShaderModule: () => ({}),
        createComputePipelineAsync: async () => ({}),
        ...overrides,
    };
}

function makeAdapter(device, overrides = {}) {
    return {
        features: new Set(['depth32float-stencil8', 'timestamp-query']),
        info: { vendor: 'fake', architecture: 'discrete', device: 'FakeGPU', description: '' },
        isFallbackAdapter: false,
        requestDevice: async () => device,
        ...overrides,
    };
}

let configureCalls = 0;
let lastConfigure = null;
function makeCanvas(overrides = {}) {
    return {
        getContext: (kind) => {
            assert.equal(kind, 'webgpu');
            return {
                configure: (descriptor) => {
                    configureCalls++;
                    lastConfigure = descriptor;
                },
            };
        },
        ...overrides,
    };
}

let adapterRequests = 0;
function installGpu(requestAdapter) {
    adapterRequests = 0;
    setNavigator({
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
        platform: 'Win32',
        gpu: {
            getPreferredCanvasFormat: () => 'bgra8unorm',
            requestAdapter: async (...args) => {
                adapterRequests++;
                return requestAdapter(...args);
            },
        },
    });
}

function reset() {
    __resetGpuContextForTests();
    configureCalls = 0;
    lastConfigure = null;
    delete globalThis.window.matchMedia;
    delete globalThis.window.webgpuProbe;
}

async function expectFailure(canvas, stage) {
    await assert.rejects(
        () => probeWebGPU(canvas),
        (err) => {
            assert.ok(
                err instanceof WebGPUUnavailableError,
                `expected WebGPUUnavailableError, got ${err}`
            );
            assert.equal(err.stage, stage, `expected stage "${stage}", got "${err.stage}"`);
            return true;
        }
    );
}

// --- Happy path ------------------------------------------------------------
{
    reset();
    const device = makeDevice();
    installGpu(async () => makeAdapter(device));

    const result = await probeWebGPU(makeCanvas());

    assert.equal(result.device, device, 'probe returns the device it created');
    assert.ok(result.adapter, 'probe returns the adapter');
    assert.ok(result.context, 'probe returns the configured canvas context');
    assert.equal(configureCalls, 1, 'swap chain configured exactly once');
    assert.equal(adapterRequests, 1, 'exactly one requestAdapter for the page');

    const report = getWebGPUProbeReport();
    assert.equal(report.ok, true);
    assert.equal(report.stage, 'ok');
    assert.equal(report.reason, null);
    // Edge and Chrome both send "Chrome/" — the report must tell them apart.
    assert.equal(report.browser.name, 'Microsoft Edge', 'Edge is not reported as Chrome');
    assert.equal(report.adapterName, 'fake · discrete · FakeGPU');
    assert.equal(globalThis.window.webgpuProbe.ok, true, 'report is mirrored onto window');
}

// --- Probe result is memoised (no second device per page) -------------------
{
    reset();
    const device = makeDevice();
    installGpu(async () => makeAdapter(device));
    const canvas = makeCanvas();

    const a = await probeWebGPU(canvas);
    const b = await probeWebGPU(canvas);

    assert.equal(a, b, 'repeat probes share one result');
    assert.equal(adapterRequests, 1, 'repeat probes do not request a second adapter');
}

// --- Stage: navigator ------------------------------------------------------
{
    reset();
    setNavigator({ userAgent: 'Mozilla/5.0 Firefox/126.0', platform: 'Linux' });
    await expectFailure(makeCanvas(), 'navigator');
    assert.equal(getWebGPUProbeReport().browser.name, 'Firefox');
}

// --- Stage: adapter — requestAdapter resolves null (the Chrome/Edge bug) ----
{
    reset();
    installGpu(async () => null);
    await expectFailure(makeCanvas(), 'adapter');

    const report = getWebGPUProbeReport();
    assert.equal(report.ok, false);
    assert.match(report.reason, /resolved null/);
    assert.equal(report.browser.name, 'Microsoft Edge', 'the failing browser is named');
}

// --- Stage: adapter — requestAdapter throws --------------------------------
{
    reset();
    installGpu(async () => {
        throw new Error('gpu process crashed');
    });
    await expectFailure(makeCanvas(), 'adapter');
    assert.match(getWebGPUProbeReport().reason, /gpu process crashed/);
}

// --- Stage: device ---------------------------------------------------------
{
    reset();
    installGpu(async () =>
        makeAdapter(null, {
            requestDevice: async () => {
                throw new Error('OperationError');
            },
        })
    );
    await expectFailure(makeCanvas(), 'device');
    // Adapter info survives into the report even though the device never existed.
    assert.equal(getWebGPUProbeReport().adapterName, 'fake · discrete · FakeGPU');
}

// --- Stage: canvas ---------------------------------------------------------
{
    reset();
    const device = makeDevice();
    installGpu(async () => makeAdapter(device));
    await expectFailure({ getContext: () => null }, 'canvas');
    assert.equal(device.destroyed, true, 'the device is destroyed rather than leaked');
}

// --- Stage: configure ------------------------------------------------------
{
    reset();
    const device = makeDevice();
    installGpu(async () => makeAdapter(device));
    await expectFailure(
        {
            getContext: () => ({
                configure: () => {
                    throw new Error('swap chain unavailable');
                },
            }),
        },
        'configure'
    );
    assert.equal(device.destroyed, true);
}

// --- Stage: pipeline — a device that cannot compile compute ----------------
{
    reset();
    const device = makeDevice({
        createComputePipelineAsync: async () => {
            throw new Error('WGSL compile failed');
        },
    });
    installGpu(async () => makeAdapter(device));
    await expectFailure(makeCanvas(), 'pipeline');
    assert.match(getWebGPUProbeReport().reason, /WGSL compile failed/);
    assert.equal(device.destroyed, true);
}

// --- Stage: pipeline — validation error surfaced via the error scope --------
{
    reset();
    const device = makeDevice({
        popErrorScope: async () => ({ message: 'entryPoint not found' }),
    });
    installGpu(async () => makeAdapter(device));
    await expectFailure(makeCanvas(), 'pipeline');
    assert.match(getWebGPUProbeReport().reason, /entryPoint not found/);
}

// --- The device is requested with the adapter's full feature set -----------
{
    reset();
    let requestedDescriptor = null;
    const device = makeDevice();
    installGpu(async () =>
        makeAdapter(device, {
            requestDevice: async (descriptor) => {
                requestedDescriptor = descriptor;
                return device;
            },
        })
    );
    await probeWebGPU(makeCanvas());

    assert.deepEqual(
        [...requestedDescriptor.requiredFeatures].sort(),
        [],
        'no extra features requested by default'
    );
    assert.equal(requestedDescriptor.requiredLimits.maxStorageBufferBindingSize, 134217728);
}

// --- Limits are clamped to the adapter: min(adapter, desired), never above ---
{
    const MiB = 1024 * 1024;
    const hw = (limits, extra = {}) => ({
        limits,
        isFallbackAdapter: false,
        ...extra,
    });
    const info = { vendor: 'nvidia', architecture: 'ada', device: '', description: '' };

    // Generous discrete adapter: storage rises to the 512 MiB soft ceiling,
    // workgroup limits stay at what the kernels declare.
    const big = resolveRequiredLimits(
        hw({
            maxBufferSize: 4096 * MiB,
            maxStorageBufferBindingSize: 2048 * MiB,
            maxComputeWorkgroupSizeX: 1024,
            maxComputeInvocationsPerWorkgroup: 1024,
            maxComputeWorkgroupStorageSize: 32768,
        }),
        info
    );
    assert.equal(big.maxStorageBufferBindingSize, 512 * MiB, 'storage uses the soft ceiling');
    assert.equal(big.maxBufferSize, 512 * MiB);
    assert.equal(big.maxComputeWorkgroupSizeX, 256, 'workgroup stays at the kernel size');
    assert.equal(big.maxComputeWorkgroupStorageSize, 16384);

    // Mid adapter: asks for exactly what it advertises, not more.
    const mid = resolveRequiredLimits(
        hw({
            maxBufferSize: 300 * MiB,
            maxStorageBufferBindingSize: 200 * MiB,
            maxComputeWorkgroupSizeX: 256,
            maxComputeInvocationsPerWorkgroup: 256,
            maxComputeWorkgroupStorageSize: 16384,
        }),
        info
    );
    assert.equal(mid.maxStorageBufferBindingSize, 200 * MiB, 'clamped to the adapter');
    assert.equal(mid.maxBufferSize, 300 * MiB);

    // A binding can never be requested larger than its buffer.
    const odd = resolveRequiredLimits(
        hw({ maxBufferSize: 256 * MiB, maxStorageBufferBindingSize: 1024 * MiB }),
        info
    );
    assert.ok(odd.maxStorageBufferBindingSize <= odd.maxBufferSize);

    // Non-conformant adapter reporting below the spec floor: never ask above it.
    const low = resolveRequiredLimits(hw({ maxStorageBufferBindingSize: 64 * MiB }), info);
    assert.equal(low.maxStorageBufferBindingSize, 64 * MiB);

    // SwiftShader (by name) and fallback adapters get exactly the spec floor,
    // however much they advertise — the CI contract.
    const generous = {
        maxBufferSize: 4096 * MiB,
        maxStorageBufferBindingSize: 2048 * MiB,
        maxComputeWorkgroupSizeX: 1024,
        maxComputeInvocationsPerWorkgroup: 1024,
        maxComputeWorkgroupStorageSize: 32768,
    };
    const swiftshader = resolveRequiredLimits(hw(generous), {
        vendor: 'google',
        architecture: 'swiftshader',
        device: '',
        description: '',
    });
    assert.deepEqual(swiftshader, GPU_REQUIRED_LIMITS, 'SwiftShader never exceeds spec defaults');
    const fallback = resolveRequiredLimits(hw(generous, { isFallbackAdapter: true }), info);
    assert.deepEqual(fallback, GPU_REQUIRED_LIMITS, 'fallback adapters never exceed spec defaults');

    // Adapter that exposes no limits object: spec floor (the pre-clamp behaviour).
    assert.deepEqual(resolveRequiredLimits({}, null), GPU_REQUIRED_LIMITS);
}

// --- Probe report carries requested vs granted limits ------------------------
{
    reset();
    const MiB = 1024 * 1024;
    let requestedDescriptor = null;
    const device = makeDevice({
        limits: {
            maxBufferSize: 512 * MiB,
            maxStorageBufferBindingSize: 512 * MiB,
            maxComputeWorkgroupSizeX: 256,
            maxComputeInvocationsPerWorkgroup: 256,
            maxComputeWorkgroupStorageSize: 16384,
        },
    });
    installGpu(async () =>
        makeAdapter(device, {
            limits: {
                maxBufferSize: 1024 * MiB,
                maxStorageBufferBindingSize: 1024 * MiB,
                maxComputeWorkgroupSizeX: 1024,
                maxComputeInvocationsPerWorkgroup: 1024,
                maxComputeWorkgroupStorageSize: 32768,
            },
            requestDevice: async (descriptor) => {
                requestedDescriptor = descriptor;
                return device;
            },
        })
    );
    const result = await probeWebGPU(makeCanvas());

    assert.equal(requestedDescriptor.requiredLimits.maxStorageBufferBindingSize, 512 * MiB);
    assert.deepEqual(result.requiredLimits, requestedDescriptor.requiredLimits);

    const report = globalThis.window.webgpuProbe;
    assert.deepEqual(report.requiredLimits, requestedDescriptor.requiredLimits);
    const storage = report.limitRequest.maxStorageBufferBindingSize;
    assert.equal(storage.floor, 128 * MiB);
    assert.equal(storage.desired, 512 * MiB);
    assert.equal(storage.adapter, 1024 * MiB);
    assert.equal(storage.requested, 512 * MiB);
    assert.equal(storage.granted, 512 * MiB);
    assert.equal(report.limits.maxStorageBufferBindingSize, 512 * MiB, 'granted snapshot kept');
}

// --- Canvas colorSpace: passed on configure, follows the display -------------
{
    reset();
    installGpu(async () => makeAdapter(makeDevice()));
    await probeWebGPU(makeCanvas());
    assert.equal(lastConfigure.colorSpace, 'srgb', 'SDR display → srgb swap chain');
    assert.equal(lastConfigure.format, 'bgra8unorm', 'swap chain uses the preferred format');
    assert.equal(lastConfigure.alphaMode, 'premultiplied');
    assert.deepEqual(getWebGPUProbeReport().canvas, {
        format: 'bgra8unorm',
        alphaMode: 'premultiplied',
        colorSpace: 'srgb',
    });
}
{
    reset();
    globalThis.window.matchMedia = (q) => ({ matches: q === '(dynamic-range: high)' });
    installGpu(async () => makeAdapter(makeDevice()));
    const probe = await probeWebGPU(makeCanvas());
    assert.equal(lastConfigure.colorSpace, 'display-p3', 'HDR display → display-p3 swap chain');
    assert.equal(probe.canvas.colorSpace, 'display-p3');

    // Three's backend init re-configures without colorSpace; re-applying must
    // restore whatever outputColorSpace the renderer landed on.
    applyCanvasColorSpace(probe, 'srgb');
    assert.equal(lastConfigure.colorSpace, 'srgb');
    assert.equal(lastConfigure.device, probe.device, 're-configure keeps the one device');
    assert.equal(lastConfigure.format, 'bgra8unorm');
    assert.equal(probe.canvas.colorSpace, 'srgb');
    assert.equal(getWebGPUProbeReport().canvas.colorSpace, 'srgb', 'report follows the re-tag');
}

// --- WebGL2 fallback contract -----------------------------------------------
// A failed probe no longer ends boot: init.ts falls back to WebGL2 and records
// it here. The probe report must keep the WebGPU stage that caused it, and
// compute consumers must fail closed immediately (no 10 s wait for a device).
{
    reset();
    setNavigator({ userAgent: 'Mozilla/5.0 Chrome/141.0.0.0' });
    await expectFailure(makeCanvas(), 'navigator');
    const ctx = settleWebGLContext('webgpu-unavailable: navigator: no gpu');
    assert.equal(ctx.backend, 'webgl');
    assert.equal(ctx.available, false);
    assert.equal(getGpuContextSync().backend, 'webgl');
    assert.equal(globalThis.window.__gpuContext.backend, 'webgl', 'published for tests/debug');
    assert.equal(getWebGPUProbeReport().stage, 'navigator', 'probe report keeps the WebGPU cause');
    const started = Date.now();
    assert.equal(await awaitGpuDevice(), null, 'no device on WebGL2');
    assert.ok(Date.now() - started < 1000, 'awaitGpuDevice fails closed without waiting');
}

// Renderer selection: WebGPU by default, WebGL2 only when asked for.
{
    globalThis.window.localStorage = { getItem: () => null, setItem() {} };
    assert.equal(resolveRendererBackend(''), 'webgpu');
    assert.equal(resolveRendererBackend('?lite'), 'webgpu', '?lite trims density, not the backend');
    assert.equal(resolveRendererBackend('?renderer=webgl'), 'webgl');
    assert.equal(resolveRendererBackend('?renderer=webgl2'), 'webgl');
    assert.equal(resolveRendererBackend('?webgl'), 'webgl');
    assert.equal(resolveRendererBackend('?webglLite=1'), 'webgl');
    globalThis.window.localStorage = { getItem: () => 'webgl', setItem() {} };
    assert.equal(resolveRendererBackend(''), 'webgl', 'stored preference applies');
    assert.equal(resolveRendererBackend('?renderer=webgpu'), 'webgpu', 'URL beats storage');
    delete globalThis.window.localStorage;
}

console.log('✓ webgpu-probe: all assertions passed');
