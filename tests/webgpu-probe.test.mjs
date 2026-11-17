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
    selectRequiredFeatures,
    wantsTimestampQuery,
    wantsOptionalGpuFeatures,
    grantedOptionalFeatures,
    extendedRangeConfigured,
    GPU_OPTIONAL_FEATURES,
} = await import('../src/rendering/gpu-context.ts');
const { HDR_STORAGE_KEY } = await import('../src/core/platform/hdr-preference.ts');
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
/**
 * `reportsConfig`: the context implements `getConfiguration()` (Chrome 131+),
 * echoing what was configured, the way the probe verifies extended range.
 * `dropsToneMapping`: a browser that accepts the configure but ignores the
 * `toneMapping` member (older Chrome), so it reports standard range.
 */
function makeCanvas(overrides = {}, { reportsConfig = false, dropsToneMapping = false } = {}) {
    return {
        getContext: (kind) => {
            assert.equal(kind, 'webgpu');
            return {
                configure: (descriptor) => {
                    configureCalls++;
                    lastConfigure = descriptor;
                },
                ...(reportsConfig
                    ? {
                          getConfiguration: () =>
                              lastConfigure && {
                                  ...lastConfigure,
                                  toneMapping: dropsToneMapping
                                      ? { mode: 'standard' }
                                      : lastConfigure.toneMapping,
                              },
                      }
                    : {}),
            };
        },
        ...overrides,
    };
}

/** A feature set the way `GPUSupportedFeatures` behaves (has + iteration). */
function featureSet(names) {
    const set = new Set(names);
    return {
        has: (n) => set.has(n),
        keys: () => set.keys(),
        [Symbol.iterator]: () => set.values(),
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
    delete globalThis.window.localStorage;
}

function hdrDisplay() {
    globalThis.window.matchMedia = (q) => ({ matches: q === '(dynamic-range: high)' });
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

const adapter3Like = { features: { has: (name) => name === 'timestamp-query' } };

// --- Features are properly requested ------------------------------------------
{
    reset();
    let requestedDescriptor = null;
    const device = makeDevice();
    installGpu(async () =>
        makeAdapter(device, {
            features: {
                has: (name) => name === 'timestamp-query' || name === 'foo',
                keys: () => ['timestamp-query', 'foo'],
                [Symbol.iterator]: function* () {
                    yield 'timestamp-query';
                    yield 'foo';
                },
            },
            requestDevice: async (descriptor) => {
                requestedDescriptor = descriptor;
                return device;
            },
        })
    );

    globalThis.window.location = { search: '' }; // default requests timestamp-query
    await probeWebGPU(makeCanvas());

    assert.deepEqual(
        [...requestedDescriptor.requiredFeatures].sort(),
        ['timestamp-query'],
        'timestamp-query requested by default'
    );
    assert.equal(requestedDescriptor.requiredLimits.maxStorageBufferBindingSize, 134217728);

    reset();
    installGpu(async () =>
        makeAdapter(device, {
            features: {
                has: (name) => name === 'timestamp-query' || name === 'foo',
                keys: () => ['timestamp-query', 'foo'],
                [Symbol.iterator]: function* () {
                    yield 'timestamp-query';
                    yield 'foo';
                },
            },
            requestDevice: async (descriptor) => {
                requestedDescriptor = descriptor;
                return device;
            },
        })
    );

    globalThis.window.location = { search: '?dynres=0' }; // opt-out
    await probeWebGPU(makeCanvas());

    assert.deepEqual(
        [...requestedDescriptor.requiredFeatures].sort(),
        [],
        'timestamp-query omitted when opt-out ?dynres=0 is given'
    );

    reset();
    installGpu(async () =>
        makeAdapter(device, {
            features: {
                has: (name) => name === 'timestamp-query' || name === 'foo',
                keys: () => ['timestamp-query', 'foo'],
                [Symbol.iterator]: function* () {
                    yield 'timestamp-query';
                    yield 'foo';
                },
            },
            requestDevice: async (descriptor) => {
                requestedDescriptor = descriptor;
                return device;
            },
        })
    );

    globalThis.window.location = { search: '?dynres=off' }; // opt-out
    await probeWebGPU(makeCanvas());

    assert.deepEqual(
        [...requestedDescriptor.requiredFeatures].sort(),
        [],
        'timestamp-query omitted when opt-out ?dynres=off is given'
    );

    reset();
    installGpu(async () =>
        makeAdapter(device, {
            features: {
                has: (name) => name === 'timestamp-query' || name === 'foo',
                keys: () => ['timestamp-query', 'foo'],
                [Symbol.iterator]: function* () {
                    yield 'timestamp-query';
                    yield 'foo';
                },
            },
            requestDevice: async (descriptor) => {
                requestedDescriptor = descriptor;
                return device;
            },
        })
    );
    globalThis.window.location = { search: '?dynres=1' }; // want timestamp
    await probeWebGPU(makeCanvas());

    assert.deepEqual(
        [...requestedDescriptor.requiredFeatures].sort(),
        ['timestamp-query'],
        'timestamp-query requested when wanted and supported'
    );

    // Default-on (fad443b / #2107): ?dynres=0 and ?dynres=off are the only opt-outs.
    for (const search of ['?dynres=0', '?dynres=off', '?dynres=OFF']) {
        globalThis.window.location = { search };
        assert.equal(wantsTimestampQuery(), false, `${search} opts out`);
        assert.deepEqual(
            selectRequiredFeatures(adapter3Like, {}),
            [],
            `${search}: timestamp-query not requested`
        );
    }
    for (const search of ['', '?dynres=1', '?dynres=false', '?foo=bar']) {
        globalThis.window.location = { search };
        assert.equal(wantsTimestampQuery(), true, `"${search}" wants timestamp-query`);
        assert.deepEqual(
            selectRequiredFeatures(adapter3Like, {}),
            ['timestamp-query'],
            `"${search}" requests it`
        );
        assert.deepEqual(
            selectRequiredFeatures({ features: { has: (n) => n === 'foo' } }, {}),
            [],
            `"${search}": adapter without the feature is not asked for it`
        );
    }

    reset();
    installGpu(async () =>
        makeAdapter(device, {
            features: {
                has: (name) => name === 'timestamp-query',
                keys: () => ['timestamp-query'],
                [Symbol.iterator]: function* () {
                    yield 'timestamp-query';
                },
            },
            requestDevice: async (descriptor) => {
                requestedDescriptor = descriptor;
                return device;
            },
        })
    );
    globalThis.window.location = { search: '?dynres=0' };
    await probeWebGPU(makeCanvas());
    assert.deepEqual(
        [...requestedDescriptor.requiredFeatures],
        [],
        '?dynres=0 probe skips timestamp-query'
    );

    globalThis.window.location = undefined; // Reset
    assert.equal(wantsTimestampQuery(), false, 'no location → false');
}

// --- selectRequiredFeatures unit test ------------------------------------------
{
    // 1. Without timestamp
    const adapter1 = { features: { has: (name) => name === 'foo' || name === 'bar' } };
    assert.deepEqual(
        selectRequiredFeatures(adapter1, { timestampQuery: false }),
        [],
        'Unknown features are not requested'
    );

    // 2. With timestamp, adapter doesn't have it
    const adapter2 = { features: { has: (name) => name === 'foo' } };
    assert.deepEqual(
        selectRequiredFeatures(adapter2, { timestampQuery: true }),
        [],
        'timestamp-query not requested if not supported'
    );

    // 3. With timestamp, adapter has it
    const adapter3 = { features: { has: (name) => name === 'timestamp-query' || name === 'foo' } };
    assert.deepEqual(
        selectRequiredFeatures(adapter3, { timestampQuery: true }),
        ['timestamp-query'],
        'timestamp-query requested when wanted and supported'
    );
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
        toneMapping: 'standard',
    });
    assert.deepEqual(lastConfigure.toneMapping, { mode: 'standard' });
    assert.equal(configureCalls, 1, 'SDR display: no extended-range attempt');
    assert.equal(getWebGPUProbeReport().hdr.attempted, false);
    assert.match(getWebGPUProbeReport().hdr.reason, /dynamic-range/);
}
{
    reset();
    globalThis.window.matchMedia = (q) => ({ matches: q === '(dynamic-range: high)' });
    installGpu(async () => makeAdapter(makeDevice()));
    const probe = await probeWebGPU(makeCanvas());
    // #1972: P3 needs a real extended-range swap chain. This context cannot
    // report its configuration, so extended range is unverifiable and the
    // probe settles on the 8-bit sRGB swap chain.
    assert.equal(lastConfigure.colorSpace, 'srgb', 'HDR display, SDR swap chain → srgb');
    assert.equal(lastConfigure.format, 'bgra8unorm');
    assert.equal(probe.canvas.colorSpace, 'srgb');
    assert.equal(probe.canvas.toneMapping, 'standard');
    assert.equal(extendedRangeConfigured(probe), false);
    assert.equal(getWebGPUProbeReport().hdr.attempted, true);
    assert.match(getWebGPUProbeReport().hdr.reason, /did not report/);

    // Three's backend init re-configures without colorSpace; re-applying must
    // restore whatever outputColorSpace the renderer landed on.
    applyCanvasColorSpace(probe, 'display-p3');
    assert.equal(lastConfigure.colorSpace, 'display-p3');
    applyCanvasColorSpace(probe, 'srgb');
    assert.equal(lastConfigure.colorSpace, 'srgb');
    assert.equal(lastConfigure.device, probe.device, 're-configure keeps the one device');
    assert.equal(lastConfigure.format, 'bgra8unorm');
    assert.equal(probe.canvas.colorSpace, 'srgb');
    assert.equal(getWebGPUProbeReport().canvas.colorSpace, 'srgb', 'report follows the re-tag');

    // Three r186 re-configures on the first frame and after every resize,
    // without colorSpace; the tag must survive those.
    applyCanvasColorSpace(probe, 'display-p3');
    probe.context.configure({
        device: probe.device,
        format: 'bgra8unorm',
        alphaMode: 'premultiplied',
    });
    assert.equal(lastConfigure.colorSpace, 'display-p3', "Three's own configure keeps the tag");
    applyCanvasColorSpace(probe, 'srgb');
    probe.context.configure({ device: probe.device, format: 'bgra8unorm' });
    assert.equal(lastConfigure.colorSpace, 'srgb', 'the pin follows the latest re-tag');
}

// --- Optional feature tiers: requested only when advertised ------------------
{
    const tiers = GPU_OPTIONAL_FEATURES.filter((n) => n !== 'timestamp-query');
    assert.deepEqual(tiers, [
        'shader-f16',
        'float32-filterable',
        'subgroups',
        'indirect-first-instance',
        'rg11b10ufloat-renderable',
    ]);

    const everything = { features: featureSet([...GPU_OPTIONAL_FEATURES, 'junk-feature']) };
    assert.deepEqual(
        selectRequiredFeatures(everything, { timestampQuery: true, optional: true }),
        [...GPU_OPTIONAL_FEATURES],
        'adapter has all: every optional feature, in list order, never junk'
    );
    assert.deepEqual(
        selectRequiredFeatures(everything, { timestampQuery: false, optional: true }),
        tiers,
        'tiers do not depend on the timestamp switch'
    );
    assert.deepEqual(
        selectRequiredFeatures(everything, { timestampQuery: true, optional: false }),
        ['timestamp-query'],
        'tiers off: timestamp-query keeps its own switch'
    );
    assert.deepEqual(
        selectRequiredFeatures({ features: featureSet(['junk-feature']) }, { optional: true }),
        [],
        'adapter lacks all: nothing requested'
    );
    assert.deepEqual(
        selectRequiredFeatures(
            { features: featureSet(['shader-f16', 'subgroups']) },
            {
                timestampQuery: true,
                optional: true,
            }
        ),
        ['shader-f16', 'subgroups'],
        'partial adapter: exactly the advertised subset'
    );

    for (const search of ['?gpuFeatures=off', '?gpuFeatures=0', '?gpuFeatures=none']) {
        globalThis.window.location = { search };
        assert.equal(wantsOptionalGpuFeatures(), false, `${search} opts out`);
    }
    for (const search of ['', '?gpuFeatures=on', '?foo=1']) {
        globalThis.window.location = { search };
        assert.equal(wantsOptionalGpuFeatures(), true, `"${search}" wants the tiers`);
    }
    globalThis.window.location = undefined;
    assert.equal(wantsOptionalGpuFeatures(), true, 'no location → tiers on (default)');
}

// Probe: adapter has every tier, device grants a subset → the report tells
// advertised / requested / granted apart per feature.
{
    reset();
    globalThis.window.location = { search: '' };
    let requested = null;
    const device = makeDevice({ features: featureSet(['timestamp-query', 'shader-f16']) });
    installGpu(async () =>
        makeAdapter(device, {
            features: featureSet([...GPU_OPTIONAL_FEATURES, 'depth32float-stencil8']),
            requestDevice: async (descriptor) => {
                requested = descriptor;
                return device;
            },
        })
    );
    const probe = await probeWebGPU(makeCanvas());
    assert.deepEqual(
        [...requested.requiredFeatures].sort(),
        [...GPU_OPTIONAL_FEATURES].sort(),
        'all advertised tiers requested, depth32float-stencil8 is not'
    );
    const { optional } = getWebGPUProbeReport().features;
    assert.deepEqual(Object.keys(optional).sort(), [...GPU_OPTIONAL_FEATURES].sort());
    assert.deepEqual(optional['shader-f16'], { adapter: true, requested: true, granted: true });
    assert.deepEqual(optional.subgroups, { adapter: true, requested: true, granted: false });
    assert.deepEqual(grantedOptionalFeatures(probe), ['timestamp-query', 'shader-f16']);
    assert.deepEqual(grantedOptionalFeatures(null), [], 'no probe (WebGL2) → none');
}

// Probe: SwiftShader as Chromium ships it (seen in a headless boot): every tier
// but shader-f16. CI therefore runs the "has it" path for four of the five,
// with limits still at the spec floor.
{
    reset();
    globalThis.window.location = { search: '' };
    let requested = null;
    const swift = { vendor: 'google', architecture: 'swiftshader', device: '', description: '' };
    const advertised = [
        'core-features-and-limits',
        'float32-filterable',
        'indirect-first-instance',
        'rg11b10ufloat-renderable',
        'subgroups',
        'timestamp-query',
    ];
    const device = makeDevice({ adapterInfo: swift, features: featureSet(advertised) });
    installGpu(async () =>
        makeAdapter(device, {
            features: featureSet(advertised),
            info: swift,
            requestDevice: async (descriptor) => {
                requested = descriptor;
                return device;
            },
        })
    );
    const probe = await probeWebGPU(makeCanvas());
    assert.deepEqual(
        [...requested.requiredFeatures],
        [
            'timestamp-query',
            'float32-filterable',
            'subgroups',
            'indirect-first-instance',
            'rg11b10ufloat-renderable',
        ],
        'SwiftShader: the advertised tiers, never core-features-and-limits'
    );
    assert.deepEqual(requested.requiredLimits, GPU_REQUIRED_LIMITS, 'limits stay at the floor');
    assert.deepEqual(getWebGPUProbeReport().features.optional['shader-f16'], {
        adapter: false,
        requested: false,
        granted: false,
    });
    assert.equal(grantedOptionalFeatures(probe).includes('shader-f16'), false);
    assert.equal(grantedOptionalFeatures(probe).length, 5);
}

// ?gpuFeatures=off: an adapter with every tier is asked for none but timestamp-query.
{
    reset();
    globalThis.window.location = { search: '?gpuFeatures=off' };
    let requested = null;
    const device = makeDevice();
    installGpu(async () =>
        makeAdapter(device, {
            features: featureSet([...GPU_OPTIONAL_FEATURES]),
            requestDevice: async (descriptor) => {
                requested = descriptor;
                return device;
            },
        })
    );
    await probeWebGPU(makeCanvas());
    assert.deepEqual([...requested.requiredFeatures], ['timestamp-query']);
    assert.equal(getWebGPUProbeReport().features.optional['shader-f16'].requested, false);
    assert.equal(getWebGPUProbeReport().features.optional['shader-f16'].adapter, true);
    globalThis.window.location = undefined;
}

// --- HDR: extended-range swap chain ------------------------------------------
// HDR display + a browser that reports the extended configure → rgba16float,
// extended tone mapping, Display P3.
{
    reset();
    hdrDisplay();
    installGpu(async () => makeAdapter(makeDevice()));
    const probe = await probeWebGPU(makeCanvas({}, { reportsConfig: true }));
    assert.equal(configureCalls, 1, 'extended configure kept, no SDR re-configure');
    assert.equal(lastConfigure.format, 'rgba16float');
    assert.deepEqual(lastConfigure.toneMapping, { mode: 'extended' });
    assert.equal(lastConfigure.colorSpace, 'display-p3');
    assert.equal(lastConfigure.alphaMode, 'premultiplied');
    assert.equal(extendedRangeConfigured(probe), true);
    const report = getWebGPUProbeReport();
    assert.deepEqual(report.canvas, {
        format: 'rgba16float',
        alphaMode: 'premultiplied',
        colorSpace: 'display-p3',
        toneMapping: 'extended',
    });
    assert.deepEqual(report.hdr, {
        display: true,
        preference: 'auto',
        attempted: true,
        configured: true,
        reason: null,
    });

    // Three re-configures with its own descriptor (format from outputType,
    // toneMapping, no colorSpace). The pin keeps colorSpace and tone mapping.
    probe.context.configure({
        device: probe.device,
        format: 'rgba16float',
        alphaMode: 'premultiplied',
    });
    assert.equal(
        lastConfigure.colorSpace,
        undefined,
        "Three's configure drops colorSpace until pinned"
    );
    applyCanvasColorSpace(probe, 'display-p3');
    assert.equal(lastConfigure.format, 'rgba16float', 're-tag keeps the HDR format');
    assert.deepEqual(lastConfigure.toneMapping, { mode: 'extended' });
    probe.context.configure({
        device: probe.device,
        format: 'rgba16float',
        alphaMode: 'premultiplied',
        toneMapping: { mode: 'standard' },
    });
    assert.equal(lastConfigure.colorSpace, 'display-p3', "Three's configure keeps P3");
    assert.deepEqual(lastConfigure.toneMapping, { mode: 'extended' }, 'and extended range');
}

// HDR display, but the browser ignores toneMapping (accepts, reports standard).
{
    reset();
    hdrDisplay();
    installGpu(async () => makeAdapter(makeDevice()));
    const probe = await probeWebGPU(
        makeCanvas({}, { reportsConfig: true, dropsToneMapping: true })
    );
    assert.equal(configureCalls, 2, 'tried extended, then the SDR configure');
    assert.equal(lastConfigure.format, 'bgra8unorm');
    assert.equal(lastConfigure.colorSpace, 'srgb');
    assert.equal(extendedRangeConfigured(probe), false);
    assert.equal(getWebGPUProbeReport().hdr.configured, false);
}

// HDR display, extended configure throws → SDR, and the probe still passes.
{
    reset();
    hdrDisplay();
    installGpu(async () => makeAdapter(makeDevice()));
    const canvas = {
        getContext: () => ({
            configure: (descriptor) => {
                configureCalls++;
                if (descriptor.format === 'rgba16float') throw new TypeError('unsupported format');
                lastConfigure = descriptor;
            },
        }),
    };
    const warn = console.warn;
    console.warn = () => {};
    const probe = await probeWebGPU(canvas);
    console.warn = warn;
    assert.equal(
        getWebGPUProbeReport().ok,
        true,
        'a rejected HDR configure is not a probe failure'
    );
    assert.equal(probe.canvas.format, 'bgra8unorm');
    assert.match(getWebGPUProbeReport().hdr.reason, /unsupported format/);
}

// HDR turned off: stored preference and ?hdr=off both keep an HDR display on SDR.
for (const setup of [
    () => {
        globalThis.window.localStorage = {
            getItem: (k) =>
                k === HDR_STORAGE_KEY ? JSON.stringify({ mode: 'off', peak: 2 }) : null,
            setItem() {},
        };
    },
    () => {
        globalThis.window.location = { search: '?hdr=off' };
    },
]) {
    reset();
    setup();
    hdrDisplay();
    installGpu(async () => makeAdapter(makeDevice()));
    const probe = await probeWebGPU(makeCanvas({}, { reportsConfig: true }));
    assert.equal(configureCalls, 1, 'no extended-range attempt');
    assert.equal(probe.canvas.format, 'bgra8unorm');
    assert.equal(getWebGPUProbeReport().hdr.preference, 'off');
    assert.match(getWebGPUProbeReport().hdr.reason, /turned off/);
    globalThis.window.location = undefined;
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
