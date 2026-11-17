/**
 * Table-driven tests for the pure WebGPU request policy
 * (`src/rendering/gpu-context-policy.ts`): which limits and features
 * `gpu-context.ts` asks the adapter for, and how the canvas is configured.
 *
 * No device is created here; `tests/webgpu-probe.test.mjs` covers the probe
 * that applies this policy.
 *
 * Run: npm run test:gpu-context-policy
 */
import assert from 'node:assert/strict';

globalThis.window = globalThis.window ?? {};

const {
    GPU_REQUIRED_LIMITS,
    GPU_DESIRED_LIMITS,
    GPU_OPTIONAL_FEATURES,
    GPU_REQUIRED_FEATURES,
    GPU_ALPHA,
    GPU_POWER_PREFERENCE,
    SCENE_PASS_SAMPLES,
    HDR_CANVAS_FORMAT,
    isSoftwareAdapter,
    resolveRequiredLimits,
    selectRequiredFeatures,
    wantsTimestampQuery,
    wantsOptionalGpuFeatures,
    resolveCanvasAntialias,
    resolveCanvasColorSpace,
    resolveCanvasConfig,
    resolveHdrIntent,
    wantsExtendedRange,
    toConfiguration,
} = await import('../src/rendering/gpu-context-policy.ts');
const gpuContext = await import('../src/rendering/gpu-context.ts');

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const KEYS = Object.keys(GPU_REQUIRED_LIMITS);
const HW = { vendor: 'nvidia', architecture: 'ampere', device: 'rtx', description: '' };

function adapter(limits, extra = {}) {
    return { limits, features: new Set(), ...extra };
}

function withWindow(win, fn) {
    const had = 'window' in globalThis;
    const prev = globalThis.window;
    globalThis.window = win;
    try {
        return fn();
    } finally {
        if (had) globalThis.window = prev;
        else delete globalThis.window;
    }
}

const hdrDisplay = (matches, search = '', stored = null) => ({
    matchMedia: (q) => ({ matches: q === '(dynamic-range: high)' && matches }),
    location: { search },
    localStorage: { getItem: () => stored },
});

// --- 1. Limits ---------------------------------------------------------------
const generous = {
    maxBufferSize: 4 * GiB,
    maxStorageBufferBindingSize: 4 * GiB,
    maxComputeWorkgroupSizeX: 1024,
    maxComputeInvocationsPerWorkgroup: 1024,
    maxComputeWorkgroupStorageSize: 65536,
};
const spec = { ...GPU_REQUIRED_LIMITS };

const limitCases = [
    {
        name: 'discrete GPU with headroom → desired ceilings',
        adapter: adapter(generous),
        info: HW,
        expect: { ...GPU_DESIRED_LIMITS },
    },
    {
        name: 'adapter at the spec defaults → floor',
        adapter: adapter(spec),
        info: HW,
        expect: spec,
    },
    {
        name: 'mid adapter (192 MiB storage, 256 MiB buffer) is never exceeded',
        adapter: adapter({
            ...spec,
            maxBufferSize: 256 * MiB,
            maxStorageBufferBindingSize: 192 * MiB,
        }),
        info: HW,
        expect: { ...spec, maxBufferSize: 256 * MiB, maxStorageBufferBindingSize: 192 * MiB },
    },
    {
        name: 'storage binding is capped at the requested maxBufferSize',
        adapter: adapter({ ...generous, maxBufferSize: 300 * MiB }),
        info: HW,
        expect: {
            ...GPU_DESIRED_LIMITS,
            maxBufferSize: 300 * MiB,
            maxStorageBufferBindingSize: 300 * MiB,
        },
    },
    {
        name: 'non-conformant adapter below the floor is not asked for more',
        adapter: adapter({ ...spec, maxStorageBufferBindingSize: 64 * MiB }),
        info: HW,
        expect: { ...spec, maxStorageBufferBindingSize: 64 * MiB },
    },
    {
        name: 'unreported keys fall back to the floor',
        adapter: adapter({}),
        info: HW,
        expect: spec,
    },
    {
        name: 'no limits object at all',
        adapter: {},
        info: null,
        expect: spec,
    },
    {
        name: 'SwiftShader (info) is held to the floor despite generous limits',
        adapter: adapter(generous),
        info: {
            vendor: 'google',
            architecture: 'swiftshader',
            device: 'SwiftShader Device',
            description: '',
        },
        expect: spec,
    },
    {
        name: 'llvmpipe is held to the floor',
        adapter: adapter(generous),
        info: { vendor: 'mesa', architecture: '', device: 'llvmpipe (LLVM 15)', description: '' },
        expect: spec,
    },
    {
        name: 'Microsoft Basic Render / WARP is held to the floor',
        adapter: adapter(generous),
        info: {
            vendor: 'microsoft',
            architecture: '',
            device: 'Microsoft Basic Render Driver',
            description: '',
        },
        expect: spec,
    },
    {
        name: 'isFallbackAdapter is held to the floor even with a hardware-looking name',
        adapter: adapter(generous, { isFallbackAdapter: true }),
        info: HW,
        expect: spec,
    },
    {
        name: 'software adapter that advertises less than the floor gets the lower value',
        adapter: adapter({ ...spec, maxBufferSize: 128 * MiB }, { isFallbackAdapter: true }),
        info: null,
        expect: { ...spec, maxBufferSize: 128 * MiB, maxStorageBufferBindingSize: 128 * MiB },
    },
];

for (const c of limitCases) {
    const got = resolveRequiredLimits(c.adapter, c.info);
    assert.deepEqual(got, c.expect, c.name);
    // Invariants that must hold for every row.
    const advertised = c.adapter.limits ?? {};
    for (const key of KEYS) {
        if (typeof advertised[key] === 'number') {
            assert.ok(
                got[key] <= advertised[key],
                `${c.name}: ${key} ${got[key]} exceeds adapter ${advertised[key]}`
            );
        }
        const ceiling = Math.max(GPU_REQUIRED_LIMITS[key], GPU_DESIRED_LIMITS[key]);
        assert.ok(got[key] <= ceiling, `${c.name}: ${key} above the desired ceiling`);
    }
    assert.ok(
        got.maxStorageBufferBindingSize <= got.maxBufferSize,
        `${c.name}: storage binding outgrew its buffer`
    );
}

assert.equal(isSoftwareAdapter(adapter({}), HW), false, 'hardware is not software');
assert.equal(isSoftwareAdapter(adapter({}, { isFallbackAdapter: true }), null), true);
assert.deepEqual(
    Object.keys(GPU_DESIRED_LIMITS).sort(),
    [...KEYS].sort(),
    'desired/floor key sets match'
);
for (const key of KEYS) {
    assert.ok(GPU_DESIRED_LIMITS[key] >= GPU_REQUIRED_LIMITS[key], `${key}: desired >= floor`);
}

// --- 2. Features ---------------------------------------------------------------
const featureAdapter = (names) => ({ features: new Set(names) });
const ALL = [...GPU_OPTIONAL_FEATURES];
const withoutTs = ALL.filter((f) => f !== 'timestamp-query');

const featureCases = [
    {
        name: 'everything advertised, everything wanted',
        has: [...ALL, 'junk'],
        opts: { timestampQuery: true, optional: true },
        expect: ALL,
    },
    {
        name: 'timestamp-query opted out',
        has: ALL,
        opts: { timestampQuery: false, optional: true },
        expect: withoutTs,
    },
    {
        name: 'optional tiers opted out, timestamp-query kept',
        has: ALL,
        opts: { timestampQuery: true, optional: false },
        expect: ['timestamp-query'],
    },
    {
        name: 'both opted out',
        has: ALL,
        opts: { timestampQuery: false, optional: false },
        expect: [],
    },
    {
        name: 'unsupported features are never requested',
        has: ['timestamp-query', 'subgroups'],
        opts: { timestampQuery: true, optional: true },
        expect: ['timestamp-query', 'subgroups'],
    },
    {
        name: 'SwiftShader-like: no shader-f16',
        has: ALL.filter((f) => f !== 'shader-f16'),
        opts: { timestampQuery: true, optional: true },
        expect: ALL.filter((f) => f !== 'shader-f16'),
    },
    {
        name: 'adapter-only junk is never requested',
        has: ['depth32float-stencil8', 'foo'],
        opts: { timestampQuery: true, optional: true },
        expect: [],
    },
    {
        name: 'no features at all',
        has: [],
        opts: { timestampQuery: true, optional: true },
        expect: [],
    },
];
for (const c of featureCases) {
    const got = selectRequiredFeatures(featureAdapter(c.has), c.opts);
    assert.deepEqual(got, c.expect, c.name);
    assert.ok(
        got.every((f) => c.has.includes(f)),
        `${c.name}: requested an unsupported feature`
    );
    assert.ok(
        got.every((f) => GPU_OPTIONAL_FEATURES.includes(f) || GPU_REQUIRED_FEATURES.includes(f)),
        `${c.name}: off-allowlist feature`
    );
}
assert.deepEqual(
    selectRequiredFeatures({}, { timestampQuery: true, optional: true }),
    [],
    'adapter without a feature set'
);
assert.deepEqual(GPU_REQUIRED_FEATURES, [], 'no feature is ever required');

const urlCases = [
    { search: '', ts: true, opt: true },
    { search: '?dynres=0', ts: false, opt: true },
    { search: '?dynres=off', ts: false, opt: true },
    { search: '?dynres=1', ts: true, opt: true },
    { search: '?gpuFeatures=off', ts: true, opt: false },
    { search: '?gpuFeatures=0', ts: true, opt: false },
    { search: '?gpuFeatures=none', ts: true, opt: false },
    { search: '?gpuFeatures=on', ts: true, opt: true },
    { search: '?dynres=off&gpuFeatures=off', ts: false, opt: false },
];
for (const c of urlCases) {
    withWindow({ location: { search: c.search } }, () => {
        assert.equal(wantsTimestampQuery(), c.ts, `${c.search || '(none)'} → timestamp-query`);
        assert.equal(wantsOptionalGpuFeatures(), c.opt, `${c.search || '(none)'} → optional tiers`);
        const got = selectRequiredFeatures(featureAdapter(ALL));
        assert.equal(
            got.includes('timestamp-query'),
            c.ts,
            `${c.search || '(none)'} → selected timestamp-query`
        );
        assert.equal(
            got.includes('shader-f16'),
            c.opt,
            `${c.search || '(none)'} → selected shader-f16`
        );
    });
}

// --- 3. Canvas / MSAA / HDR ---------------------------------------------------
assert.equal(GPU_ALPHA, true);
assert.equal(GPU_POWER_PREFERENCE, 'high-performance');
assert.equal(SCENE_PASS_SAMPLES, 4);
assert.equal(resolveCanvasAntialias(false), false, 'post stack on: no canvas MSAA');
assert.equal(resolveCanvasAntialias(true), true, '?postfx=off keeps canvas MSAA');

const USAGE = 0x11;
const canvasCases = [
    {
        name: 'SDR display, SDR swap chain',
        win: hdrDisplay(false),
        extended: false,
        expect: {
            format: 'bgra8unorm',
            alphaMode: 'premultiplied',
            colorSpace: 'srgb',
            toneMapping: 'standard',
            usage: USAGE,
        },
    },
    {
        name: 'HDR display, SDR swap chain stays srgb',
        win: hdrDisplay(true),
        extended: false,
        expect: {
            format: 'bgra8unorm',
            alphaMode: 'premultiplied',
            colorSpace: 'srgb',
            toneMapping: 'standard',
            usage: USAGE,
        },
    },
    {
        name: 'HDR display, extended swap chain',
        win: hdrDisplay(true),
        extended: true,
        expect: {
            format: HDR_CANVAS_FORMAT,
            alphaMode: 'premultiplied',
            colorSpace: 'display-p3',
            toneMapping: 'extended',
            usage: USAGE,
        },
    },
    {
        name: 'SDR display never gets P3, even if extended is asked for',
        win: hdrDisplay(false),
        extended: true,
        expect: {
            format: HDR_CANVAS_FORMAT,
            alphaMode: 'premultiplied',
            colorSpace: 'srgb',
            toneMapping: 'extended',
            usage: USAGE,
        },
    },
];
for (const c of canvasCases) {
    withWindow(c.win, () => {
        const config = resolveCanvasConfig({
            preferredFormat: 'bgra8unorm',
            usage: USAGE,
            extended: c.extended,
        });
        assert.deepEqual(config, c.expect, c.name);
        assert.equal(
            resolveCanvasColorSpace(c.extended),
            c.expect.colorSpace,
            `${c.name}: color space helper`
        );
    });
}
withWindow(hdrDisplay(false), () => {
    const config = resolveCanvasConfig({
        preferredFormat: 'rgba8unorm',
        usage: USAGE,
        extended: false,
    });
    assert.equal(config.format, 'rgba8unorm', 'SDR uses the adapter preferred format');
});

const hdrCases = [
    {
        name: 'SDR display',
        win: hdrDisplay(false),
        wanted: false,
        reason: 'display is not (dynamic-range: high)',
    },
    { name: 'HDR display, auto', win: hdrDisplay(true), wanted: true, reason: null },
    {
        name: 'HDR display, ?hdr=off',
        win: hdrDisplay(true, '?hdr=off'),
        wanted: false,
        reason: 'HDR turned off (candy.hdr / ?hdr=off)',
    },
    {
        name: 'HDR display, stored off',
        win: hdrDisplay(true, '', JSON.stringify({ mode: 'off' })),
        wanted: false,
        reason: 'HDR turned off (candy.hdr / ?hdr=off)',
    },
];
for (const c of hdrCases) {
    withWindow(c.win, () => {
        const intent = resolveHdrIntent();
        assert.equal(intent.wanted, c.wanted, c.name);
        assert.equal(wantsExtendedRange(), c.wanted, `${c.name}: wantsExtendedRange`);
        assert.equal(intent.report.reason, c.reason, `${c.name}: reason`);
        assert.equal(intent.report.attempted, false);
        assert.equal(intent.report.configured, false);
    });
}

const fakeDevice = {};
const cfg = toConfiguration(fakeDevice, canvasCases[2].expect);
assert.deepEqual(cfg, {
    device: fakeDevice,
    format: HDR_CANVAS_FORMAT,
    usage: USAGE,
    alphaMode: 'premultiplied',
    colorSpace: 'display-p3',
    toneMapping: { mode: 'extended' },
});

// --- 4. gpu-context keeps its public surface -------------------------------------
for (const name of [
    'GPU_REQUIRED_LIMITS',
    'GPU_DESIRED_LIMITS',
    'GPU_POWER_PREFERENCE',
    'GPU_ALPHA',
    'GPU_OPTIONAL_FEATURES',
    'GPU_REQUIRED_FEATURES',
    'SCENE_PASS_SAMPLES',
    'HDR_CANVAS_FORMAT',
    'resolveRequiredLimits',
    'selectRequiredFeatures',
    'wantsTimestampQuery',
    'wantsOptionalGpuFeatures',
    'wantsExtendedRange',
    'resolveCanvasAntialias',
    'resolveCanvasColorSpace',
]) {
    assert.ok(name in gpuContext, `gpu-context.ts still exports ${name}`);
}
assert.equal(gpuContext.GPU_REQUIRED_LIMITS, GPU_REQUIRED_LIMITS, 're-export is the same object');
assert.equal(gpuContext.resolveRequiredLimits, resolveRequiredLimits);

console.log('✅ gpu-context-policy: limits, features, canvas/MSAA tables pass');
