/**
 * Lightweight GI (irradiance probe volume) — decision layer + bake behaviour.
 * Run: npm run test:gi
 *
 * The GPU side (four `texture3D` fetches in the unified material) cannot be
 * exercised headlessly, so this covers what actually decides the look: the
 * quality gate, the volume geometry, and the CPU bake — including the candy
 * guardrail that bounce keeps its chroma instead of settling into grey.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/core/config/defaults.ts';
import { clampGridAxis, resolveGiSettings } from '../src/core/config/postfx.ts';
import {
    __probeWorldPosition,
    __readProbeL0,
    __resetIrradianceProbesForTests,
    getIrradianceNode,
    getIrradianceStats,
    initIrradianceProbes,
    isIrradianceEnabled,
    setIrradianceEnabled,
    updateIrradianceProbes,
} from '../src/rendering/irradiance-probes.ts';
import { registerDecorativeFill, releaseLocalLight } from '../src/rendering/lights.ts';
import {
    applyStartupCapabilities,
    __resetStartupCapabilitiesForTests,
} from '../src/core/startup/capabilities.ts';
import { positionWorld, normalWorld } from 'three/tsl';

const giCfg = CONFIG.lighting.gi;
const original = { ...giCfg };

function withGraphics(graphics) {
    applyStartupCapabilities({
        path: 'play',
        graphics,
        warmup: { materialSubset: graphics === 'low' ? 'minimal' : 'batched' },
        postfx: { quality: graphics === 'low' ? 'off' : graphics === 'high' ? 'high' : 'low' },
        deferred: { aurora: graphics === 'high', fluidFog: graphics !== 'low' },
        shadows: { enabled: graphics !== 'low', resolution: graphics === 'high' ? 'high' : 'low' },
    });
}

/**
 * Synthetic heightfield: flat ground at y=0 everywhere, plus a "roof" over the
 * region x < -20 that stands in for the sugar caves — anything under it should
 * bake as interior rather than open sky.
 */
function testGround(x) {
    return x < -20 ? 24 : 0;
}

function restore() {
    Object.assign(giCfg, original);
    __resetStartupCapabilitiesForTests();
    __resetIrradianceProbesForTests();
}

// clampGridAxis keeps a probe axis in the interpolatable 2–32 band
{
    assert.equal(clampGridAxis(1), 2, 'clamps below range');
    assert.equal(clampGridAxis(0), 2);
    assert.equal(clampGridAxis(10), 10);
    assert.equal(clampGridAxis(9.6), 10, 'rounds');
    assert.equal(clampGridAxis(99), 32, 'clamps above range');
    assert.equal(clampGridAxis(Number.NaN), 2, 'defensive default');
}

// Quality gate: off on low, base grid on medium, denser on high
{
    withGraphics('low');
    assert.equal(resolveGiSettings().enabled, false, 'GI is skipped on the low tier');
    restore();

    withGraphics('medium');
    const medium = resolveGiSettings();
    assert.equal(medium.enabled, true);
    assert.equal(medium.gridX, giCfg.gridX);
    assert.equal(medium.cellSize, giCfg.cellSize);
    assert.equal(medium.probesPerFrame, giCfg.probesPerFrame);
    restore();

    withGraphics('high');
    const high = resolveGiSettings();
    assert.equal(high.enabled, true);
    assert.equal(high.gridX, giCfg.gridXHigh);
    assert.equal(high.gridY, giCfg.gridYHigh);
    assert.equal(high.gridZ, giCfg.gridZHigh);
    assert.equal(high.cellSize, giCfg.cellSizeHigh);
    assert.ok(
        high.gridX * high.gridY * high.gridZ > medium.gridX * medium.gridY * medium.gridZ,
        'high tier is denser than medium'
    );
    restore();
}

// Hard off switches beat the tier
{
    withGraphics('high');
    giCfg.forceDisable = true;
    assert.equal(resolveGiSettings().enabled, false, 'forceDisable wins over the tier');
    restore();

    withGraphics('high');
    giCfg.enabled = false;
    assert.equal(resolveGiSettings().enabled, false, 'CONFIG.enabled=false wins over the tier');
    restore();
}

// Low tier allocates nothing at all — no volume, and no shader term to compile
{
    withGraphics('low');
    const scene = new THREE.Scene();
    assert.equal(
        initIrradianceProbes(scene, testGround),
        false,
        'init reports the volume was skipped'
    );
    assert.equal(isIrradianceEnabled(), false);
    assert.equal(
        getIrradianceNode(positionWorld, normalWorld),
        null,
        'materials compile without a GI term when the volume is absent'
    );
    assert.equal(getIrradianceStats().probes, 0);
    restore();
}

// Medium tier: volume geometry matches the resolved settings
{
    withGraphics('medium');
    const scene = new THREE.Scene();
    assert.equal(initIrradianceProbes(scene, testGround), true);

    const stats = getIrradianceStats();
    assert.equal(stats.enabled, true);
    assert.equal(stats.gridX, giCfg.gridX);
    assert.equal(stats.probes, giCfg.gridX * giCfg.gridY * giCfg.gridZ);
    assert.equal(stats.cellSize, giCfg.cellSize);
    assert.notEqual(
        getIrradianceNode(positionWorld, normalWorld),
        null,
        'materials pick up a GI term when the volume exists'
    );
    restore();
}

// The volume follows the camera and snaps to whole cells (so it cannot swim)
{
    withGraphics('medium');
    initIrradianceProbes(new THREE.Scene(), testGround);

    const centre = new THREE.Vector3(37.3, 4.1, -22.8);
    updateIrradianceProbes(centre, {});

    const probe = __probeWorldPosition(0, new THREE.Vector3());
    const cell = giCfg.cellSize;
    for (const axis of ['x', 'y', 'z']) {
        assert.ok(
            Math.abs(probe[axis] / cell - Math.round(probe[axis] / cell)) < 1e-6,
            `probe origin is snapped to the cell grid on ${axis}`
        );
    }

    const halfX = (giCfg.gridX - 1) * 0.5 * cell;
    assert.ok(
        Math.abs(probe.x + halfX - centre.x) <= cell,
        'the volume is centred on the camera within one cell'
    );
    restore();
}

// A saturated donor bleeds its colour into nearby probes — and stays a pastel,
// not grey. This is the whole point of the effect.
{
    withGraphics('medium');
    initIrradianceProbes(new THREE.Scene(), testGround);

    const centre = new THREE.Vector3(0, 6, 0);
    // Bake once with no donors so we have a baseline for the same probe.
    updateIrradianceProbes(centre, {});

    // Pick a probe the bake has certainly reached (nearest-first ordering) and
    // hang a hot magenta fill right on it.
    const target = new THREE.Vector3();
    let index = -1;
    for (let i = 0; i < getIrradianceStats().probes; i++) {
        __probeWorldPosition(i, target);
        if (target.distanceTo(centre) < giCfg.cellSize) {
            index = i;
            break;
        }
    }
    assert.ok(index >= 0, 'found a probe near the volume centre');
    __probeWorldPosition(index, target);

    const before = new THREE.Color();
    __readProbeL0(index, before);

    const host = new THREE.Object3D();
    host.position.copy(target);
    host.updateMatrixWorld();
    const donor = registerDecorativeFill({
        id: 'test-gi-donor',
        color: 0xff2fbf, // hot magenta — deliberately far from any grey
        intensity: 4,
        distance: 12,
        parent: host,
    });
    assert.ok(donor, 'decorative fill registered');

    // Re-bake enough frames that the nearest-first walk covers the whole volume.
    const passes = Math.ceil(getIrradianceStats().probes / giCfg.probesPerFrame) + 1;
    for (let i = 0; i < passes; i++) updateIrradianceProbes(centre, {});

    const after = new THREE.Color();
    __readProbeL0(index, after);

    const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    assert.ok(lum(after) > lum(before), 'the donor raised irradiance at the probe');

    const hsl = { h: 0, s: 0, l: 0 };
    const mag = Math.max(after.r, after.g, after.b);
    assert.ok(mag > 0, 'probe carries energy');
    new THREE.Color(after.r / mag, after.g / mag, after.b / mag).getHSL(hsl);
    assert.ok(
        hsl.s >= 0.25,
        `bounce keeps its chroma (saturation ${hsl.s.toFixed(3)}) rather than reading as grey dirt`
    );
    assert.ok(after.r > after.g, 'the magenta donor tints the bounce toward its own hue');

    releaseLocalLight('test-gi-donor');
    restore();
}

// Under a roof (the sugar-caves stand-in) probes read as interior: no sky, and
// an icy fill instead of black.
{
    withGraphics('medium');
    initIrradianceProbes(new THREE.Scene(), testGround);

    const centre = new THREE.Vector3(-60, 8, 0);
    const passes = Math.ceil(getIrradianceStats().probes / giCfg.probesPerFrame) + 1;
    for (let i = 0; i < passes; i++) updateIrradianceProbes(centre, {});

    const pos = new THREE.Vector3();
    const l0 = new THREE.Color();
    let checked = 0;
    for (let i = 0; i < getIrradianceStats().probes; i++) {
        __probeWorldPosition(i, pos);
        // Well under the roof, so openness is unambiguously zero.
        if (pos.x >= -25 || pos.y > 14) continue;
        const skyVis = __readProbeL0(i, l0);
        assert.equal(skyVis, 0, `probe under the roof sees no sky (x=${pos.x}, y=${pos.y})`);
        assert.ok(
            l0.r + l0.g + l0.b > 0,
            'interior probes carry the cave fill rather than pure black'
        );
        assert.ok(l0.b > l0.r, 'the interior fill is icy, not warm');
        checked++;
    }
    assert.ok(checked > 0, 'the volume actually contained interior probes');
    restore();
}

// Toggling off drops the term without tearing the volume down
{
    withGraphics('medium');
    initIrradianceProbes(new THREE.Scene(), testGround);
    assert.equal(isIrradianceEnabled(), true);

    setIrradianceEnabled(false);
    assert.equal(isIrradianceEnabled(), false, 'toggle off restores the pre-GI look');
    assert.equal(getIrradianceStats().enabled, false);

    setIrradianceEnabled(true);
    assert.equal(isIrradianceEnabled(), true, 'and back on again');
    restore();
}

console.log('✓ irradiance-probes: gate, volume geometry, candy bounce, toggle');
