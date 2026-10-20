/**
 * Run mode + platform capabilities (#1972).
 * Run: npm run test:run-mode
 *
 * Only a harness (webdriver, __IS_FULL_BOOT_TEST, HeadlessChrome/) is
 * `automation`; every real browser UA — Macs included — is `player`.
 */
import assert from 'node:assert/strict';
import { ColorManagement } from 'three';
import {
    resolveHdrSupport,
    resolvePlatformCapabilities,
} from '../src/core/platform/capabilities.ts';
import {
    __resetRunModeForTests,
    classifyRunMode,
    getRunMode,
    isLoopFreezeRequested,
} from '../src/core/platform/run-mode.ts';
import { ensureOutputColorSpace } from '../src/rendering/color-spaces.ts';
import { resolveCanvasColorSpace } from '../src/rendering/gpu-context.ts';

const PLAYER_UAS = {
    'Mac Chrome':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mac Safari':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    'Mac Firefox':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
    'Mac Edge':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    // iPadOS 13+ Safari requests the desktop site with a Mac UA by default.
    'iPadOS (desktop UA)':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
    'iPadOS (mobile UA)':
        'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    'iPhone Chrome':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
    'Windows Chrome':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Windows Edge':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    'Windows Firefox':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
    'Linux Chrome':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Linux Firefox': 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
    ChromeOS:
        'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Android Chrome':
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    'Android Samsung Internet':
        'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    empty: '',
};

const HEADLESS_CHROME =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36';

const signals = (userAgent, extra = {}) => ({
    userAgent,
    webdriver: false,
    fullBootTest: false,
    ...extra,
});

// The regression itself: the old check matched every Mac UA.
{
    const OLD = /headless|playwright|ci|test/i;
    assert.ok(OLD.test(PLAYER_UAS['Mac Chrome']), 'sanity: old regex matched "Macintosh"');
}

// Real browsers are players.
for (const [name, ua] of Object.entries(PLAYER_UAS)) {
    assert.equal(classifyRunMode(signals(ua)), 'player', `${name} must be a player`);
}

// Only explicit harness signals are automation.
assert.equal(classifyRunMode(signals(HEADLESS_CHROME)), 'automation', 'HeadlessChrome/');
for (const [name, ua] of Object.entries(PLAYER_UAS)) {
    assert.equal(
        classifyRunMode(signals(ua, { webdriver: true })),
        'automation',
        `${name} + navigator.webdriver`
    );
    assert.equal(
        classifyRunMode(signals(ua, { fullBootTest: true })),
        'automation',
        `${name} + __IS_FULL_BOOT_TEST`
    );
}
// "Headless" in another product name is not the HeadlessChrome token.
assert.equal(classifyRunMode(signals('Mozilla/5.0 NotHeadlessChromeish/1.0')), 'player');

// getRunMode() reads the live globals.
{
    const hadWindow = 'window' in globalThis;
    const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const setNavigator = (nav) =>
        Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });

    globalThis.window = { location: { search: '' } };
    setNavigator({ userAgent: PLAYER_UAS['Mac Safari'], webdriver: false });
    __resetRunModeForTests();
    assert.equal(getRunMode(), 'player', 'Mac Safari globals → player');

    __resetRunModeForTests();
    globalThis.window.__IS_FULL_BOOT_TEST = true;
    assert.equal(getRunMode(), 'automation', 'window.__IS_FULL_BOOT_TEST → automation');

    __resetRunModeForTests();
    globalThis.window = { location: { search: '' } };
    setNavigator({ userAgent: PLAYER_UAS['Mac Chrome'], webdriver: true });
    assert.equal(getRunMode(), 'automation', 'navigator.webdriver → automation');

    // ?freezeLoop is the only way to skip the animation loop.
    assert.equal(isLoopFreezeRequested(), false);
    globalThis.window = { location: { search: '?freezeLoop=1' } };
    assert.equal(isLoopFreezeRequested(), true);

    __resetRunModeForTests();
    if (!hadWindow) delete globalThis.window;
    if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc);
}

// Platform capabilities.
{
    const base = {
        runMode: 'player',
        backend: 'webgpu',
        fallbackAdapter: false,
        gpuPrefersLite: false,
        deviceMemoryGB: undefined,
        timestampQuery: true,
        displayHdr: false,
        extendedRange: false,
        graphicsOverride: null,
    };
    const caps = (o = {}) => resolvePlatformCapabilities({ ...base, ...o });

    const mac = caps();
    assert.equal(mac.computeAvailable, true, 'player on WebGPU gets compute');
    assert.equal(mac.tier, 'high');
    assert.ok(Object.isFrozen(mac) && Object.isFrozen(mac.hdr), 'capabilities are frozen');

    const harness = caps({ runMode: 'automation' });
    assert.equal(harness.computeAvailable, false);
    assert.equal(harness.tier, 'low');

    const gl = caps({ backend: 'webgl2' });
    assert.equal(gl.computeAvailable, false);
    assert.equal(gl.timestampQuery, false);
    assert.equal(gl.tier, 'low');

    assert.equal(caps({ deviceMemoryGB: 4 }).tier, 'low');
    assert.equal(caps({ deviceMemoryGB: 8 }).tier, 'medium');
    assert.equal(caps({ gpuPrefersLite: true }).tier, 'medium');
    assert.equal(caps({ deviceMemoryGB: 16 }).tier, 'high');
    assert.equal(caps({ fallbackAdapter: true }).tier, 'low');
    assert.equal(caps({ deviceMemoryGB: 2, graphicsOverride: 'high' }).tier, 'high');
    assert.equal(caps({ graphicsOverride: 'ultra' }).tier, 'high');

    // HDR: P3 only with a real extended-range swap chain on WebGPU.
    assert.equal(caps({ displayHdr: true }).hdr.canvas, 'srgb');
    assert.equal(caps({ displayHdr: true, extendedRange: true }).hdr.canvas, 'display-p3');
    assert.equal(
        caps({ displayHdr: true, extendedRange: true, backend: 'webgl2' }).hdr.canvas,
        'srgb'
    );
    assert.deepEqual(resolveHdrSupport(false, true), {
        display: false,
        extendedRange: false,
        canvas: 'srgb',
    });
}

// HDR display mocked: the probe's canvas space is sRGB (no extended range is
// configured), and P3 — if ever selected — is registered before use.
{
    const hadWindow = 'window' in globalThis;
    globalThis.window = {
        matchMedia: (q) => ({ matches: q === '(dynamic-range: high)' }),
    };
    assert.equal(resolveCanvasColorSpace(), 'srgb', 'HDR display, SDR swap chain → srgb');
    if (!hadWindow) delete globalThis.window;

    // Three 0.171 does not know P3 until it is registered: this is the TypeError.
    assert.throws(() => ColorManagement.getPrimaries('display-p3'), TypeError);
    assert.equal(ensureOutputColorSpace('display-p3'), 'display-p3');
    assert.ok(Array.isArray(ColorManagement.getPrimaries('display-p3')));
    assert.ok(ColorManagement.getTransfer('display-p3'));
    assert.equal(ColorManagement._getDrawingBufferColorSpace('display-p3'), 'display-p3');
    assert.equal(ensureOutputColorSpace('srgb'), 'srgb');

    const warn = console.warn;
    console.warn = () => {};
    assert.equal(ensureOutputColorSpace('rec2100-pq'), 'srgb', 'unknown space falls back');
    console.warn = warn;
}

console.log('run-mode: all assertions passed');
