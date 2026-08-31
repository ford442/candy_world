/**
 * Post-FX resolution: AO gate + bloom knobs.
 * Run: pnpm run test:postfx
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

{
    const root = dirname(fileURLToPath(import.meta.url));
    const webgpuPost = readFileSync(join(root, '../src/foliage/post-processing-webgpu.ts'), 'utf8');
    const deferred = readFileSync(join(root, '../src/core/deferred-init.ts'), 'utf8');
    const warmup = readFileSync(join(root, '../src/rendering/shader-warmup.ts'), 'utf8');

    assert.match(webgpuPost, /gradeCandyGlowPulse/);
    assert.match(webgpuPost, /mixStrobeFlash/);
    assert.doesNotMatch(
        webgpuPost,
        /viewportSharedTexture/,
        'WebGPU post graph must sample the scene pass, not copyFramebufferToTexture'
    );
    assert.match(deferred, /isWebGLNodeBackend/);
    assert.match(deferred, /useViewportPulseOverlays/);
    assert.match(warmup, /HalfFloatType/);
}

console.log('postfx tests passed');
