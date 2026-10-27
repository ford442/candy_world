/**
 * Post-FX resolution: AO gate + bloom knobs.
 * Run: pnpm run test:postfx
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/config/defaults.ts';
import {
    isAoEnabled,
    isDofEnabled,
    isPostStackBypassed,
    resolvePostfxQuality,
} from '../src/core/config/postfx.ts';
import { isDynamicResolutionAllowed, resolveAntialiasMode } from '../src/core/config/postfx.ts';
import {
    createDynamicResolution,
    defaultDynamicResolutionConfig,
    stepDynamicResolution,
} from '../src/rendering/dynamic-resolution.ts';
import { resolveCanvasAntialias, SCENE_PASS_SAMPLES } from '../src/rendering/gpu-context.ts';
import { isWebGLBackendRenderer } from '../src/rendering/renderer-mode.ts';
import { isCascadeSupported } from '../src/systems/shadow-cascades.ts';
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

// Only the explicit URL flag bypasses the post graph. The low tier (and WebGL2 /
// automation) resolve quality 'off' but keep bloom + grade.
{
    const prevWindow = globalThis.window;
    globalThis.window = { location: { search: '' } };
    withGraphics('low');
    assert.equal(resolvePostfxQuality(), 'off');
    assert.equal(isPostStackBypassed(), false, 'low tier keeps the post graph');
    globalThis.window.location.search = '?postfx=off';
    assert.equal(isPostStackBypassed(), true);
    globalThis.window.location.search = '?postfx=low';
    assert.equal(isPostStackBypassed(), false);
    __resetStartupCapabilitiesForTests();
    globalThis.window = prevWindow;
}

// MSAA is paid once: on the scene pass while the post graph runs, on the canvas
// only when the world is drawn straight to it.
{
    assert.equal(SCENE_PASS_SAMPLES, 4);
    assert.equal(resolveCanvasAntialias(false), false, 'post quad needs no canvas MSAA');
    assert.equal(resolveCanvasAntialias(true), true, '?postfx=off keeps canvas MSAA');
}

// AA mode: post-AA where the scene pass has no MSAA, MSAA elsewhere, TRAA opt-in.
{
    const prevWindow = globalThis.window;
    globalThis.window = { location: { search: '' } };
    withGraphics('low');
    assert.equal(resolveAntialiasMode('webgpu'), 'fxaa', 'low tier: FXAA, no MSAA buffer');
    __resetStartupCapabilitiesForTests();
    withGraphics('medium');
    assert.equal(resolveAntialiasMode('webgpu'), 'msaa');
    assert.equal(resolveAntialiasMode('webgl'), 'fxaa', 'WebGL2 finally gets AA');
    globalThis.window.location.search = '?aa=traa';
    assert.equal(resolveAntialiasMode('webgpu'), 'traa');
    globalThis.window.location.search = '?aa=bogus';
    assert.equal(resolveAntialiasMode('webgpu'), 'msaa', 'unknown ?aa= falls back to the tier');
    // GTAO gathers the scene depth; a 4× pass's depth has no textureGather.
    globalThis.window.location.search = '';
    assert.equal(resolveAntialiasMode('webgpu', true), 'smaa', 'GTAO on: SMAA, not MSAA');
    globalThis.window.location.search = '?aa=msaa';
    assert.equal(resolveAntialiasMode('webgpu', true), 'smaa', '?aa=msaa cannot break GTAO');
    globalThis.window.location.search = '?aa=traa';
    assert.equal(resolveAntialiasMode('webgpu', true), 'traa', 'single-sampled modes are kept');
    globalThis.window.location.search = '?dynres=off';
    assert.equal(isDynamicResolutionAllowed(), false);
    __resetStartupCapabilitiesForTests();
    globalThis.window = prevWindow;
}

// Dynamic resolution: hysteresis, pixel-proportional drops, bounded band.
{
    const cfg = defaultDynamicResolutionConfig({ budgetMs: 10 });
    let s = { scale: 1, overCount: 0, underCount: 0 };
    s = stepDynamicResolution(s, 20, cfg);
    assert.equal(s.scale, 1, 'one spike does not drop the scale');
    s = stepDynamicResolution(s, 20, cfg);
    assert.equal(s.scale, 0.85, 'two over-budget samples drop it, by at most maxDrop');
    s = stepDynamicResolution(s, 9, cfg);
    assert.equal(s.overCount, 0, 'inside the band the streak resets');
    s = stepDynamicResolution(s, 11, cfg);
    s = stepDynamicResolution(s, 11, cfg);
    // 0.85 × sqrt(10 / 11) = 0.81 → one step (0.05) is the minimum drop.
    assert.equal(s.scale, 0.8);
    for (let i = 0; i < 40; i++) s = stepDynamicResolution(s, 50, cfg);
    assert.equal(s.scale, cfg.minScale, 'never below the floor');
    for (let i = 0; i < cfg.raiseAfter - 1; i++) s = stepDynamicResolution(s, 3, cfg);
    assert.equal(s.scale, cfg.minScale, 'raising waits for a calm streak');
    s = stepDynamicResolution(s, 3, cfg);
    assert.equal(s.scale, 0.65, 'then rises one step');
    for (let i = 0; i < 200; i++) s = stepDynamicResolution(s, 1, cfg);
    assert.equal(s.scale, 1, 'never above the drawing buffer');
    assert.deepEqual(stepDynamicResolution(s, NaN, cfg), s, 'a bad sample is ignored');

    const applied = [];
    const dr = createDynamicResolution((scale) => applied.push(scale), cfg);
    dr.sample(30);
    dr.sample(30);
    assert.deepEqual(applied, [0.85], 'apply only on change');
    assert.equal(dr.lastGpuMs, 30);
}

// `isWebGPURenderer` is true under forceWebGL too; only the backend is truthful.
{
    const webgpu = { isWebGPURenderer: true, backend: { isWebGPUBackend: true } };
    const forcedWebGL = { isWebGPURenderer: true, backend: { isWebGLBackend: true } };
    assert.equal(isWebGLBackendRenderer(webgpu), false);
    assert.equal(isWebGLBackendRenderer(forcedWebGL), true);
    assert.equal(isWebGLBackendRenderer(null), false);
    assert.equal(isCascadeSupported(webgpu), true);
    assert.equal(isCascadeSupported(forcedWebGL), false, 'WebGL2 keeps the single follow map');
    assert.equal(isCascadeSupported(null), false);
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
    // Warmup compiles the real scene (real target, pipelines kept), not 1×1 clones.
    assert.match(warmup, /compileAsync\(scene, camera\)/);
    assert.doesNotMatch(warmup, /new THREE\.RenderTarget\(/);
    assert.match(webgpuPost, /compileTarget/);
    // The scene pass asks for its own MSAA rather than inheriting renderer.samples,
    // and only in msaa mode.
    assert.match(
        webgpuPost,
        /pass\(scene, camera, \{ samples: aa === 'msaa' \? opts\.sceneSamples : 0 \}\)/
    );
    // Post-AA runs on the tone-mapped image, without a second colour transform.
    assert.match(webgpuPost, /outputColorTransform = false/);
    assert.match(webgpuPost, /fxaa\(display\)/);
}

console.log('postfx tests passed');
