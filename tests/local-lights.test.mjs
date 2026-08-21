/**
 * Unit tests for the local point/spot registry.
 * Run: npm run test:lights
 *
 * GPU shadow maps cannot be exercised headlessly. These cover CONFIG defaults,
 * the extra-map budget, quality-tier / WebGL skips, decorative descriptors,
 * and pool reuse (no per-call allocation of new THREE lights).
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/core/config/defaults.ts';
import {
    applyStartupCapabilities,
    __resetStartupCapabilitiesForTests,
} from '../src/core/startup/capabilities.ts';
import {
    createPointLight,
    createSpotLight,
    registerDecorativeFill,
    releaseLocalLight,
    localShadowsAllowed,
    getLocalLightStats,
    modulateDecorativeLight,
    forEachLocalLight,
    __resetLocalLightsForTests,
    __bindLocalLightsForTests,
} from '../src/rendering/lights.ts';

const localCfg = CONFIG.lighting.local;
const originalMax = localCfg.maxLocalShadowLights;

function withCaps(graphics, shadows) {
    applyStartupCapabilities({
        path: 'play',
        graphics,
        warmup: { materialSubset: graphics === 'low' ? 'minimal' : 'batched' },
        postfx: { quality: graphics === 'high' ? 'high' : graphics === 'low' ? 'off' : 'low' },
        deferred: { aurora: false, fluidFog: graphics !== 'low' },
        shadows,
    });
}

function setup(webgl = false, graphics = 'medium') {
    __resetLocalLightsForTests();
    withCaps(graphics, {
        enabled: graphics !== 'low',
        resolution: graphics === 'high' ? 'high' : graphics === 'low' ? 'off' : 'low',
    });
    const scene = new THREE.Scene();
    const allowShadows = !webgl && graphics !== 'low';
    __bindLocalLightsForTests(scene, webgl, allowShadows);
    return scene;
}

function restore() {
    localCfg.maxLocalShadowLights = originalMax;
    __resetLocalLightsForTests();
    __resetStartupCapabilitiesForTests();
}

{
    const scene = setup();
    const h = createPointLight({ parent: scene });
    assert.ok(h && h.light, 'point handle');
    assert.equal(h.light.decay, localCfg.pointDecay, 'inverse-square decay');
    assert.equal(h.light.distance, localCfg.pointDistance);
    assert.equal(h.light.intensity, localCfg.pointIntensity);
    assert.equal(h.light.color.getHex(), localCfg.pointColor, 'pastel default, not white');
    assert.equal(h.castsShadow, false, 'shadows are opt-in');
    restore();
}

{
    const scene = setup();
    const h = createSpotLight({ parent: scene });
    assert.ok(h && h.light);
    const spot = h.light;
    assert.equal(spot.angle, localCfg.spotAngle);
    assert.equal(spot.penumbra, localCfg.spotPenumbra);
    assert.equal(spot.decay, localCfg.spotDecay);
    assert.equal(spot.color.getHex(), localCfg.spotColor);
    restore();
}

{
    const scene = setup(false, 'medium');
    assert.equal(localShadowsAllowed(), true);
    const a = createSpotLight({ parent: scene, castShadow: true, id: 's1' });
    const b = createSpotLight({ parent: scene, castShadow: true, id: 's2' });
    assert.equal(a.castsShadow, true, 'first extra map granted');
    assert.equal(b.castsShadow, false, 'budget caps at maxLocalShadowLights');
    assert.equal(getLocalLightStats().shadows, 1);
    restore();
}

{
    const scene = setup(false, 'low');
    assert.equal(localShadowsAllowed(), false, 'low tier skips extra maps');
    const h = createSpotLight({ parent: scene, castShadow: true, id: 'low-spot' });
    assert.ok(h && h.light, 'still illuminates');
    assert.equal(h.light.intensity, localCfg.spotIntensity);
    assert.equal(h.castsShadow, false);
    assert.equal(getLocalLightStats().maxShadows, 0);
    restore();
}

{
    const scene = setup(true, 'medium');
    assert.equal(localShadowsAllowed(), false, 'WebGL is directional-only for extras');
    const h = createPointLight({ parent: scene, castShadow: true, id: 'gl-pt' });
    assert.ok(h && h.light);
    assert.equal(h.castsShadow, false);
    restore();
}

{
    const parent = new THREE.Group();
    setup();
    const deco = registerDecorativeFill({
        parent,
        color: 0xff69b4,
        intensity: 0.3,
        distance: 2,
        id: 'flower-head',
    });
    assert.ok(deco);
    assert.equal(deco.gpu, false);
    assert.equal(deco.light, null);
    assert.equal(parent.children.length, 0, 'no THREE.PointLight on generation props');
    let found = 0;
    forEachLocalLight((snap) => {
        if (snap.id === 'flower-head') {
            found += 1;
            assert.equal(snap.role, 'decorative');
            assert.equal(snap.gpu, false);
            assert.equal(snap.color, 0xff69b4);
        }
    });
    assert.equal(found, 1, 'clustered walk sees decorative fills');
    modulateDecorativeLight('flower-head', 0.2);
    forEachLocalLight((snap) => {
        if (snap.id === 'flower-head') assert.ok(Math.abs(snap.intensity - 0.06) < 1e-6);
    });
    restore();
}

{
    const scene = setup();
    const a = createPointLight({ id: 'reuse', parent: scene });
    const obj = a.light;
    releaseLocalLight('reuse');
    const b = createPointLight({ id: 'reuse-2', parent: scene });
    assert.equal(b.light, obj, 'pool reuses the same THREE.PointLight');
    restore();
}

{
    const scene = setup();
    const first = createPointLight({ id: 'same', parent: scene, intensity: 1 });
    const again = createPointLight({ id: 'same', parent: scene, intensity: 99 });
    assert.equal(again.light, first.light);
    assert.equal(again.light.intensity, 1, 'same id does not realloc or clobber');
    restore();
}

console.log('local-lights: all assertions passed');
