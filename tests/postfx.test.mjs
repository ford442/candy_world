/**
 * Post-FX resolution: AO gate + bloom knobs.
 * Run: pnpm run test:postfx
 */
import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/config/defaults.ts';
import { isAoEnabled, isDofEnabled, resolvePostfxQuality } from '../src/core/config/postfx.ts';
import {
    applyStartupCapabilities,
    __resetStartupCapabilitiesForTests,
} from '../src/core/startup/capabilities.ts';

function withGraphics(graphics) {
    applyStartupCapabilities({
        path: 'play',
        graphics,
        warmup: { materialSubset: graphics === 'low' ? 'minimal' : 'batched' },
        postfx: { quality: graphics === 'high' ? 'high' : graphics === 'low' ? 'off' : 'low' },
        deferred: { aurora: false, fluidFog: graphics !== 'low' },
        shadows: {
            enabled: graphics !== 'low',
            resolution: graphics === 'high' ? 'high' : graphics === 'low' ? 'off' : 'low',
        },
    });
}

{
    assert.equal(CONFIG.postfx.bloomThreshold, 0.85);
    assert.equal(CONFIG.postfx.bloomRadius, 0.5);
    assert.equal(CONFIG.postfx.aoEnabled, false);
}

{
    withGraphics('low');
    assert.equal(resolvePostfxQuality(), 'off');
    assert.equal(isAoEnabled(), false, 'AO off on low / postfx off');
    assert.equal(isDofEnabled(), false);
    __resetStartupCapabilitiesForTests();
}

{
    withGraphics('medium');
    assert.equal(resolvePostfxQuality(), 'low');
    assert.equal(isAoEnabled(), false, 'AO off on default low postfx');
    __resetStartupCapabilitiesForTests();
}

{
    withGraphics('high');
    assert.equal(resolvePostfxQuality(), 'high');
    assert.equal(isAoEnabled(), true, 'AO on when postfx is high');
    __resetStartupCapabilitiesForTests();
}

console.log('postfx tests passed');
