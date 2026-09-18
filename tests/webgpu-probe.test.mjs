/**
 * Unit tests for the WebGPU hard-fail boot probe.
 *
 * The contract under test: `probeWebGPU()` is the only adapter/device request,
 * it fails at a *named* stage, and it never hands back a half-built device that
 * a caller could mistake for a working one.
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
    configureCanvasColorSpace,
    resolveRequiredLimits,
    GPU_REQUIRED_LIMITS,
} = await import('../src/rendering/gpu-context.ts');

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
                configure: (config) => {
                    configureCalls++;
                    lastConfigure = config;
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
        ['depth32float-stencil8', 'timestamp-query'],
        'every adapter feature is requested, matching what Three would ask for'
    );
    // The fake adapter advertises no limits, so every key falls back to spec defaults.
    assert.equal(requestedDescriptor.requiredLimits.maxStorageBufferBindingSize, 134217728);
    assert.equal(requestedDescriptor.requiredLimits.maxBufferSize, 268435456);
}

// --- Limits: clamped to the adapter on hardware ------------------------------
{
    const hardware = {
        limits: {
            maxBufferSize: 4294967296,
            maxStorageBufferBindingSize: 2147483648,
            maxComputeWorkgroupSizeX: 1024,
            maxComputeInvocationsPerWorkgroup: 1024,
            maxComputeWorkgroupStorageSize: 65536,
        },
    };
    const info = { vendor: 'nvidia', architecture: 'ampere', device: '', description: '' };
    assert.deepEqual(resolveRequiredLimits(hardware, info), {
        maxBufferSize: 1073741824,
        maxStorageBufferBindingSize: 1073741824,
        maxComputeWorkgroupSizeX: 256,
        maxComputeInvocationsPerWorkgroup: 256,
        maxComputeWorkgroupStorageSize: 16384,
    });

    // An adapter below the soft ceiling is asked for exactly what it has,
    // and a binding never exceeds the requested buffer size.
    const small = {
        limits: {
            ...hardware.limits,
            maxBufferSize: 536870912,
            maxStorageBufferBindingSize: 805306368,
        },
    };
    const req = resolveRequiredLimits(small, info);
    assert.equal(req.maxBufferSize, 536870912);
    assert.equal(req.maxStorageBufferBindingSize, 536870912);
}

// --- Limits: software adapters never ask above spec defaults ----------------
{
    const generous = {
        limits: {
            maxBufferSize: 4294967296,
            maxStorageBufferBindingSize: 2147483648,
            maxComputeWorkgroupSizeX: 1024,
            maxComputeInvocationsPerWorkgroup: 1024,
            maxComputeWorkgroupStorageSize: 65536,
        },
    };
    const swiftshader = {
        vendor: 'google',
        architecture: 'swiftshader',
        device: '',
        description: '',
    };
    const req = resolveRequiredLimits(generous, swiftshader);
    for (const [key, value] of Object.entries(GPU_REQUIRED_LIMITS)) {
        assert.equal(req[key], value, `SwiftShader ${key} stays at the spec default`);
    }
    assert.equal(req.maxBufferSize, 268435456);

    const fallback = resolveRequiredLimits({ ...generous, isFallbackAdapter: true }, null);
    assert.equal(
        fallback.maxStorageBufferBindingSize,
        134217728,
        'isFallbackAdapter is capped too'
    );
}

// --- Report carries requested vs granted limits ------------------------------
{
    reset();
    const device = makeDevice({
        limits: {
            maxBufferSize: 1073741824,
            maxStorageBufferBindingSize: 1073741824,
            maxComputeWorkgroupSizeX: 256,
        },
    });
    installGpu(async () =>
        makeAdapter(device, {
            limits: { maxBufferSize: 2147483648, maxStorageBufferBindingSize: 2147483648 },
        })
    );
    await probeWebGPU(makeCanvas());

    const report = globalThis.window.webgpuProbe;
    assert.equal(report.requestedLimits.maxStorageBufferBindingSize, 1073741824);
    assert.equal(report.grantedLimits.maxStorageBufferBindingSize, 1073741824);
    assert.deepEqual(
        Object.keys(report.grantedLimits).sort(),
        ['maxBufferSize', 'maxComputeWorkgroupSizeX', 'maxStorageBufferBindingSize'],
        'granted limits are reported for the requested keys the device exposes'
    );
}

// --- Canvas colorSpace follows outputColorSpace ------------------------------
{
    reset();
    const device = makeDevice();
    installGpu(async () => makeAdapter(device));
    const probe = await probeWebGPU(makeCanvas());

    assert.equal(lastConfigure.colorSpace, 'srgb', 'probe configures srgb explicitly');
    assert.equal(lastConfigure.format, 'bgra8unorm');
    assert.equal(getWebGPUProbeReport().canvas.colorSpace, 'srgb');

    configureCanvasColorSpace(probe, 'display-p3');
    assert.equal(lastConfigure.colorSpace, 'display-p3');
    assert.equal(lastConfigure.alphaMode, 'premultiplied', 'reconfigure keeps alpha mode');
    assert.equal(globalThis.window.__gpuContext.canvas.colorSpace, 'display-p3');
    assert.equal(globalThis.window.webgpuProbe.canvas.colorSpace, 'display-p3');

    configureCanvasColorSpace(probe, 'srgb-linear');
    assert.equal(lastConfigure.colorSpace, 'srgb', 'non-display spaces present as srgb');
}

console.log('✓ webgpu-probe: all assertions passed');
