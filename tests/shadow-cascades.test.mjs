/**
 * Pure unit tests for cascade resolution in resolveShadowSettings().
 * Run: npm run test:cascades
 *
 * The GPU side of CSM cannot be exercised headlessly, so these cover the
 * decision layer: tier → cascade count / map size, and the hard off switches.
 */
import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/config/defaults.ts';
import {
    clampCascadeCount,
    clampSoftness,
    resolveShadowSettings,
    shadowFilterTapCount,
    shadowKernelForResolution,
    softnessToRadius,
} from '../src/core/config/postfx.ts';
import { cascadeMapSizes } from '../src/systems/shadow-cascades.ts';
import {
    applyStartupCapabilities,
    __resetStartupCapabilitiesForTests,
} from '../src/core/startup/capabilities.ts';

const shadowCfg = CONFIG.lighting.shadows;
const original = { ...shadowCfg };

function withCaps(shadows) {
    applyStartupCapabilities({
        path: 'play',
        graphics: 'medium',
        warmup: { materialSubset: 'batched' },
        postfx: { quality: 'low' },
        deferred: { aurora: false, fluidFog: true },
        shadows,
    });
}

function restore() {
    Object.assign(shadowCfg, original);
    __resetStartupCapabilitiesForTests();
}

// clampCascadeCount keeps counts in the supported 2–4 band
{
    assert.equal(clampCascadeCount(1), 2, 'clamps below range');
    assert.equal(clampCascadeCount(2), 2);
    assert.equal(clampCascadeCount(3), 3);
    assert.equal(clampCascadeCount(4), 4);
    assert.equal(clampCascadeCount(9), 4, 'clamps above range');
    assert.equal(clampCascadeCount(2.6), 3, 'rounds');
    assert.equal(clampCascadeCount(Number.NaN), 2, 'defensive default');
}

// Default (low-res) shadow tier → default cascade count at base map size
{
    withCaps({ enabled: true, resolution: 'low' });
    const s = resolveShadowSettings();
    assert.equal(s.enabled, true);
    assert.equal(s.mapSize, shadowCfg.mapSize);
    assert.equal(s.cascades, shadowCfg.cascadeCount);
    restore();
}

// High shadow tier → high cascade count at the high map size
{
    withCaps({ enabled: true, resolution: 'high' });
    const s = resolveShadowSettings();
    assert.equal(s.enabled, true);
    assert.equal(s.mapSize, shadowCfg.mapSizeHigh);
    assert.equal(s.cascades, shadowCfg.cascadeCountHigh);
    restore();
}

// Cascade counts are clamped even if CONFIG is edited out of range
{
    shadowCfg.cascadeCountHigh = 12;
    withCaps({ enabled: true, resolution: 'high' });
    assert.equal(resolveShadowSettings().cascades, 4);
    restore();
}

// cascadesEnabled=false keeps shadows on but drops to the single follow map
{
    shadowCfg.cascadesEnabled = false;
    withCaps({ enabled: true, resolution: 'high' });
    const s = resolveShadowSettings();
    assert.equal(s.enabled, true, 'shadows still render');
    assert.equal(s.cascades, 0, 'no cascades → legacy path');
    restore();
}

// low tier (shadows off in capabilities) → shadow pass skipped entirely
{
    withCaps({ enabled: false, resolution: 'off' });
    const s = resolveShadowSettings();
    assert.equal(s.enabled, false);
    assert.equal(s.cascades, 0);
    assert.equal(s.mapSize, 0);
    restore();
}

// forceDisable is a hard off switch regardless of tier
{
    shadowCfg.forceDisable = true;
    withCaps({ enabled: true, resolution: 'high' });
    const s = resolveShadowSettings();
    assert.equal(s.enabled, false);
    assert.equal(s.cascades, 0);
    restore();
}

// Map-size taper: near cascade keeps the full budget, farther ones halve down
{
    assert.deepEqual(cascadeMapSizes(2048, 3), [2048, 1024, 512], 'high tier taper');
    assert.deepEqual(cascadeMapSizes(1024, 2), [1024, 512], 'default tier taper');
    assert.deepEqual(
        cascadeMapSizes(1024, 4),
        [1024, 512, 512, 512],
        'floors at cascadeMapSizeMin instead of collapsing to nothing'
    );
    assert.deepEqual(cascadeMapSizes(2048, 0), [], 'no cascades → no maps');
    restore();
}

// Taper disabled → flat allocation at the full map size
{
    shadowCfg.cascadeMapSizeTaper = false;
    assert.deepEqual(cascadeMapSizes(2048, 3), [2048, 2048, 2048]);
    restore();
}

// Tapering must never exceed the flat budget it replaces
{
    const flat = 2048 * 2048 * 3;
    const tapered = cascadeMapSizes(2048, 3).reduce((sum, n) => sum + n * n, 0);
    assert.ok(tapered < flat, 'taper saves shadow memory');
    restore();
}

// Softness maps onto a live texel radius without requiring a kernel recode
{
    assert.equal(clampSoftness(-1), 0);
    assert.equal(clampSoftness(2), 1);
    assert.equal(clampSoftness(Number.NaN), 0);
    assert.equal(softnessToRadius(0, 4), 0.25, 'hard contact stays sub-texel');
    assert.equal(softnessToRadius(1, 4), 4, 'max hits pcfRadius');
    assert.equal(softnessToRadius(0.6, 4), 0.25 + 3.75 * 0.6);
    assert.equal(shadowKernelForResolution('off'), 1);
    assert.equal(shadowKernelForResolution('low'), 3);
    assert.equal(shadowKernelForResolution('high'), 5);
    assert.equal(shadowFilterTapCount(1), 1);
    assert.equal(shadowFilterTapCount(3), 13, '3×3 PCF + 4-tap contact ring');
    assert.equal(shadowFilterTapCount(5), 29, '5×5 PCF + 4-tap contact ring');
}

// Default shadow tier uses 3×3 PCF; PCSS stays off even if CONFIG asks
{
    shadowCfg.pcssEnabled = true;
    withCaps({ enabled: true, resolution: 'low' });
    const s = resolveShadowSettings();
    assert.equal(s.kernel, 3);
    assert.equal(s.pcssEnabled, false, 'PCSS is high-tier only');
    assert.equal(s.pcssLightSize, 0);
    assert.ok(s.radius > 1, 'default softness is wider than the old 1-texel PCFSoft');
    restore();
}

// High tier: 5×5 kernel; PCSS only when CONFIG (or ?pcss) enables it
{
    shadowCfg.pcssEnabled = true;
    withCaps({ enabled: true, resolution: 'high' });
    const s = resolveShadowSettings();
    assert.equal(s.kernel, 5);
    assert.equal(s.pcssEnabled, true);
    assert.equal(s.pcssLightSize, shadowCfg.pcssLightSize);
    restore();
}

console.log('shadow-cascades: all assertions passed');

