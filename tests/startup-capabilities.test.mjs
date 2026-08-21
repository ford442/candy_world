/**
 * Pure unit tests for resolveStartupCapabilities().
 * Run: pnpm run test:capabilities
 */
import assert from 'node:assert/strict';
import { resolveStartupCapabilities } from '../src/core/startup/capabilities.ts';
import { mapSizeToStartupPath, resolveBootPathFromUrl } from '../src/core/startup-profile.ts';

const base = {
    profile: { path: 'play', graphics: 'medium' },
    deviceTier: 'high',
    isFallbackAdapter: false,
    forceWebGL: false,
    isHeadlessOrCI: false,
    url: {},
};

function resolve(overrides = {}) {
    return resolveStartupCapabilities({
        ...base,
        ...overrides,
        profile: { ...base.profile, ...(overrides.profile ?? {}) },
        url: { ...base.url, ...(overrides.url ?? {}) },
    });
}

// Graphics table
{
    const low = resolve({ profile: { graphics: 'low' } });
    assert.equal(low.graphics, 'low');
    assert.equal(low.warmup.materialSubset, 'minimal');
    assert.equal(low.postfx.quality, 'off');
    assert.equal(low.deferred.aurora, false);
    assert.equal(low.deferred.fluidFog, false);
    assert.equal(low.shadows.enabled, false);

    const mid = resolve({ profile: { graphics: 'medium' } });
    assert.equal(mid.warmup.materialSubset, 'batched');
    assert.equal(mid.postfx.quality, 'low');
    assert.equal(mid.deferred.aurora, false);
    assert.equal(mid.deferred.fluidFog, true);
    assert.equal(mid.shadows.resolution, 'low');

    const high = resolve({ profile: { graphics: 'high' } });
    assert.equal(high.warmup.materialSubset, 'full');
    assert.equal(high.postfx.quality, 'high');
    assert.equal(high.deferred.aurora, true);
    assert.equal(high.shadows.resolution, 'high');

    const ultra = resolve({ profile: { graphics: 'ultra' } });
    assert.equal(ultra.graphics, 'high', 'ultra clamps to high on the start path');
    assert.equal(ultra.warmup.materialSubset, 'full');
}

// Fallback / WebGL / CI force lite
{
    const fallback = resolve({ isFallbackAdapter: true, profile: { graphics: 'high' } });
    assert.equal(fallback.graphics, 'low');
    assert.equal(fallback.postfx.quality, 'off');
    assert.equal(fallback.deferred.aurora, false);

    const webgl = resolve({ forceWebGL: true, profile: { graphics: 'high' } });
    assert.equal(webgl.graphics, 'low');
    assert.equal(webgl.postfx.quality, 'off');

    const ci = resolve({ isHeadlessOrCI: true, profile: { graphics: 'high' } });
    assert.equal(ci.graphics, 'low');
    assert.equal(ci.warmup.materialSubset, 'none');
    assert.equal(ci.postfx.quality, 'off');
}

// URL postfx still wins as a temporary override
{
    const forced = resolve({
        isFallbackAdapter: true,
        url: { postfx: 'high' },
    });
    assert.equal(forced.postfx.quality, 'high');
    assert.equal(forced.graphics, 'low');
}

// URL boot / waitForFull
{
    const instant = resolve({ url: { boot: 'instant' } });
    assert.equal(instant.path, 'play');
    assert.equal(instant.world.size, 180);

    const explore = resolve({ profile: { path: 'play' }, url: { boot: 'explore' } });
    assert.equal(explore.path, 'explore');
    assert.equal(explore.world.size, 400);

    const core = resolve({ url: { boot: 'core' } });
    assert.equal(core.path, 'core');
    assert.equal(core.world.size, 120);

    const wait = resolve({ profile: { path: 'play' }, url: { waitForFull: true } });
    assert.equal(wait.path, 'explore');
}

// Persisted path is honoured when URL is empty
{
    const persisted = resolve({ profile: { path: 'explore', graphics: 'medium' }, url: {} });
    assert.equal(persisted.path, 'explore');
    assert.equal(persisted.graphics, 'medium');
}

// URL / mapSize compat
{
    assert.equal(mapSizeToStartupPath('small'), 'core');
    assert.equal(mapSizeToStartupPath('medium'), 'play');
    assert.equal(mapSizeToStartupPath('large'), 'explore');
    assert.equal(resolveBootPathFromUrl(new URLSearchParams('boot=instant')), 'play');
    assert.equal(resolveBootPathFromUrl(new URLSearchParams('boot=explore')), 'explore');
    assert.equal(resolveBootPathFromUrl(new URLSearchParams('map=small')), 'core');
    assert.equal(resolveBootPathFromUrl(new URLSearchParams('map=large')), 'explore');
}

console.log('startup-capabilities: all assertions passed');
