/**
 * Shared "dream sky" environment map for candy materials.
 *
 * Candy World has no HDRI and no `scene.environment`: before this module every
 * `MeshPhysicalNodeMaterial` reflected *nothing*, so `Crystal` and `Gummy` —
 * the two presets whose whole read is "you are looking through/into me" — got
 * their specular highlight from the sun alone and landed somewhere between
 * grey studio plastic and wet glass.
 *
 * The fix is one procedural equirectangular sky, generated once, handed to
 * every material that opts in via `useDreamEnv`. Three's `EnvironmentNode`
 * keeps a module-level `WeakMap` from texture → PMREM, so *every* material
 * pointed at this one texture shares a single PMREM chain — no per-instance
 * env maps, no extra render targets per batcher.
 *
 * Two deliberate non-choices:
 *   - We set `material.envMap`, not `material.envNode`. `EnvironmentNode` only
 *     honours `envMapIntensity` when `material.envMap` is truthy (r171,
 *     `EnvironmentNode.setup()`); going through `envNode` would silently pin
 *     intensity to `scene.environmentIntensity` and make the knob a no-op.
 *   - No new TSL nodes are introduced. Opting a preset in swaps one IBL term
 *     into its graph; it does not fork a second shader variant, so
 *     `shader-warmup.ts` compiles the same number of programs as before.
 */

import * as THREE from 'three';
import { getUrlFlag } from '../../core/config/url-flags.ts';
import { isCIorHeadless } from '../../core/config/runtime.ts';

/** 🎨 PALETTE: dream-sky gradient. Hue rides from candy blue toward violet. */
const SKY_HUE_BASE = 0.6;
const SKY_HUE_SPAN = 0.1;
const SKY_SATURATION = 0.8;
/** Keeps the horizon from crushing to black — pastel floor, never grey studio. */
const SKY_LIGHTNESS_BASE = 0.2;
const SKY_LIGHTNESS_SPAN = 0.6;
/** Visual Impact: cloud streaks. Higher = busier reflections on Crystal facets. */
const CLOUD_MIX = 0.3;

const ENV_SIZE = 512;

let _dreamEnvTexture: THREE.DataTexture | null = null;
let _enabledOverride: boolean | null = null;
let _resolved: boolean | null = null;

/**
 * The procedural dream sky, as an equirectangular `DataTexture`.
 *
 * Generated at most once per session (~1 MB, RGBA8). Also sampled directly —
 * with explicit UVs, so `mapping` is irrelevant there — by
 * [`mirrors.ts`](../mirrors.ts), which is why this lives in `material-core`
 * rather than next to the mirrors that used to own it.
 */
export function getDreamEnvTexture(): THREE.DataTexture {
    if (_dreamEnvTexture) return _dreamEnvTexture;

    const size = ENV_SIZE;
    const data = new Uint8Array(size * size * 4);
    const skyColor = new THREE.Color();
    const cloudColor = new THREE.Color(0xffffff);

    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            const idx = (i * size + j) * 4;

            const u = j / size;
            const v = i / size;

            skyColor.setHSL(
                SKY_HUE_BASE + u * SKY_HUE_SPAN,
                SKY_SATURATION,
                SKY_LIGHTNESS_BASE + v * SKY_LIGHTNESS_SPAN
            );

            const noise = Math.sin(u * 20.0 + v * 15.0) * 0.5 + 0.5;
            skyColor.lerp(cloudColor, noise * CLOUD_MIX * (1.0 - v));

            data[idx] = Math.floor(skyColor.r * 255);
            data[idx + 1] = Math.floor(skyColor.g * 255);
            data[idx + 2] = Math.floor(skyColor.b * 255);
            data[idx + 3] = 255;
        }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    // Lets PMREMGenerator pick its equirect path. Harmless for the mirrors,
    // which sample with explicit UVs and never consult `mapping`.
    tex.mapping = THREE.EquirectangularReflectionMapping;
    // Left at the default (no colour-space conversion) on purpose: flipping it
    // to sRGB would re-tone the mirrors, which have shipped against this exact
    // byte data since they were written.
    tex.needsUpdate = true;

    _dreamEnvTexture = tex;
    return tex;
}

/**
 * Whether presets may attach the dream env this session.
 *
 * Mirrors the GI gate in `resolveGiSettings()`: off on CI / headless and on the
 * `low` graphics tier, forceable either way with `?env=on` / `?env=off`. The
 * tier is read from the value `applyStartupCapabilities()` publishes rather
 * than by importing `capabilities.ts`, which would drag the GPU-context module
 * into every foliage bundle.
 */
export function isDreamEnvEnabled(): boolean {
    if (_enabledOverride !== null) return _enabledOverride;
    if (_resolved !== null) return _resolved;

    const flag = getUrlFlag('env');
    if (flag === 'off') return (_resolved = false);
    if (flag === 'on') return (_resolved = true);

    if (isCIorHeadless()) return (_resolved = false);

    let graphics: string | undefined;
    try {
        graphics = (globalThis as any).window?.__startupCapabilities?.graphics;
    } catch {
        graphics = undefined;
    }
    if (graphics === 'low') return (_resolved = false);

    return (_resolved = true);
}

/**
 * Force the env on or off. Materials already built keep the graph they compiled
 * with — like GI, this only affects materials created afterwards.
 */
export function setDreamEnvEnabled(enabled: boolean | null): void {
    _enabledOverride = enabled;
}

/**
 * Attach the shared dream env to a material, honouring the session gate.
 *
 * Returns `true` when the env was attached, so callers can log or branch.
 */
export function applyDreamEnv(
    // Structural, not `MeshPhysicalMaterial`: the node-material class hierarchy
    // widens `defines` to optional, so the nominal type does not accept it.
    material: { envMap: THREE.Texture | null; envMapIntensity: number },
    intensity = 1.0
): boolean {
    if (!isDreamEnvEnabled()) return false;
    material.envMap = getDreamEnvTexture();
    material.envMapIntensity = intensity;
    return true;
}

/** Test / teardown hook. The PMREM three derives from the texture is freed with it. */
export function disposeDreamEnv(): void {
    _dreamEnvTexture?.dispose();
    _dreamEnvTexture = null;
    _resolved = null;
}
