/**
 * Controllable sun-shadow softness for the WebGPU node path.
 *
 * r171 fact: `renderer.shadowMap.type = PCFSoftShadowMap` selects
 * `PCFSoftShadowFilter`, a fixed 1-texel bilinear 3×3 that **never reads
 * `shadow.radius`**. `PCFShadowMap` does honor radius (17-tap). We attach our
 * own `shadow.filterNode` so quality can pick a 3×3 or 5×5 kernel and so a
 * softness slider can retune `shadow.radius` without recoding the graph.
 *
 * PCSS here is a cheap contact term (edge-aware radius + light size), not a
 * blocker-search area light. `pcssLightSize === 0` turns it off live.
 *
 * @see docs/SHADOW_SOFTNESS.md
 */
import * as THREE from 'three';
import { Fn, texture, vec2, float, reference, abs, mix, clamp, renderGroup } from 'three/tsl';
import { CONFIG } from '../core/config/defaults.ts';
import {
    clampSoftness,
    softnessToRadius,
    shadowFilterTapCount,
    type ShadowKernel,
    type ShadowSettings,
} from '../core/config/postfx.ts';
import type { SunCascades } from '../systems/shadow-cascades.ts';

export type SoftLightShadow = THREE.LightShadow & {
    filterNode?: unknown;
    pcssLightSize?: number;
};

export interface ShadowSoftnessState {
    softness: number;
    radius: number;
    kernel: ShadowKernel;
    pcssEnabled: boolean;
    pcssLightSize: number;
    /** Hardware compares per fragment per cascade (includes the 4-tap ring). */
    tapsPerCascade: number;
    cascades: number;
}

const _bound: SoftLightShadow[] = [];
let _kernel: ShadowKernel = 3;
let _cascades = 0;

/** r171 `Fn` types the callback as `{ [key: string]: unknown }` — keep that shape. */
type TslFnFactory = (js: (args: Record<string, unknown>) => unknown) => unknown;

const tslFn = Fn as unknown as TslFnFactory;

type GroupedRef = {
    add: (...args: unknown[]) => GroupedRef;
    sub: (...args: unknown[]) => GroupedRef;
    mul: (...args: unknown[]) => GroupedRef;
    div: (...args: unknown[]) => GroupedRef;
    clamp: (...args: unknown[]) => GroupedRef;
};

function groupedRef(name: string, type: string, object: object): GroupedRef {
    const node = reference(name, type, object) as unknown as {
        setGroup: (group: typeof renderGroup) => GroupedRef;
    };
    return node.setGroup(renderGroup);
}

type UvNode = { add: (offset: unknown) => unknown };

function candyHardShadowFilter() {
    return tslFn((args) => {
        const depthTexture = args['depthTexture'];
        const shadowCoord = args['shadowCoord'] as { xy: unknown; z: unknown };
        return texture(depthTexture as never, shadowCoord.xy as never).compare(
            shadowCoord.z as never
        );
    });
}

function createCandyPcfFilter(kernel: 3 | 5) {
    const half = (kernel - 1) / 2;
    const taps = kernel * kernel;

    return tslFn((args) => {
        const depthTexture = args['depthTexture'];
        const shadowCoord = args['shadowCoord'] as { xy: UvNode; z: unknown };
        const shadow = args['shadow'] as SoftLightShadow;

        const depthCompare = (uv: unknown, compare: unknown) =>
            texture(depthTexture as never, uv as never).compare(compare as never);

        const mapSize = groupedRef('mapSize', 'vec2', shadow);
        const radius = groupedRef('radius', 'float', shadow);
        const lightSize = groupedRef('pcssLightSize', 'float', shadow);

        const texelSize = vec2(1).div(mapSize as never);
        const uv = shadowCoord.xy;
        const z = shadowCoord.z;

        // 4-tap ring: detect umbra vs penumbra so interiors stay readable.
        const ring = depthCompare(uv.add(texelSize.mul(vec2(-0.5, -0.5)).mul(radius as never)), z)
            .add(depthCompare(uv.add(texelSize.mul(vec2(0.5, -0.5)).mul(radius as never)), z))
            .add(depthCompare(uv.add(texelSize.mul(vec2(-0.5, 0.5)).mul(radius as never)), z))
            .add(depthCompare(uv.add(texelSize.mul(vec2(0.5, 0.5)).mul(radius as never)), z))
            .mul(0.25);

        const edgeAmt = float(1)
            .sub(abs(ring.sub(0.5)).mul(2))
            .clamp(0, 1);
        const contactRadius = mix(float(0.4), radius as never, edgeAmt);
        const effective = mix(radius as never, contactRadius, clamp(lightSize as never, 0, 1));

        let sum = float(0);
        for (let y = -half; y <= half; y++) {
            for (let x = -half; x <= half; x++) {
                const offset = texelSize.mul(vec2(x, y)).mul(effective);
                sum = sum.add(depthCompare(uv.add(offset), z));
            }
        }
        return sum.mul(1 / taps);
    });
}

const CandyHardShadowFilter = /*@__PURE__*/ candyHardShadowFilter();
const CandyPcf3Filter = /*@__PURE__*/ createCandyPcfFilter(3);
const CandyPcf5Filter = /*@__PURE__*/ createCandyPcfFilter(5);

function filterForKernel(kernel: ShadowKernel): unknown {
    if (kernel >= 5) return CandyPcf5Filter;
    if (kernel <= 1) return CandyHardShadowFilter;
    return CandyPcf3Filter;
}

function bindShadow(
    shadow: SoftLightShadow,
    settings: ShadowSettings,
    radiusOverride?: number
): void {
    shadow.filterNode = filterForKernel(settings.kernel);
    shadow.radius = radiusOverride ?? settings.radius;
    shadow.pcssLightSize = settings.pcssLightSize;
    if (!_bound.includes(shadow)) _bound.push(shadow);
}

/**
 * Attach the candy PCF filter to the sun (and every CSM cascade clone).
 *
 * CSM's `light.shadow.clone()` does not copy `filterNode` or `normalBias`, so
 * this must run *after* `initSunCascades()`.
 */
export function applyShadowSoftness(
    sunLight: THREE.DirectionalLight,
    settings: ShadowSettings,
    cascades: SunCascades | null = null
): void {
    _bound.length = 0;
    _kernel = settings.kernel;
    _cascades = settings.cascades;

    if (!settings.enabled) {
        publishState();
        return;
    }

    bindShadow(sunLight.shadow as SoftLightShadow, settings);

    if (cascades) {
        _cascades = cascades.cascades;
        const cfg = CONFIG.lighting.shadows;
        cascades.node.lights.forEach((lw) => {
            const shadow = lw.shadow as SoftLightShadow | undefined;
            if (!shadow) return;
            // LightShadow.copy() skips normalBias — restore the glossy-acne pairing.
            shadow.normalBias = cfg.normalBias;
            bindShadow(shadow, settings);
        });
    }

    publishState();
}

/** Apply the session filter to an extra local shadow map (optional per-light softness). */
export function applyLocalShadowSoftness(
    shadow: THREE.LightShadow,
    settings: ShadowSettings,
    softnessOverride?: number
): void {
    if (!settings.enabled) return;
    const radius =
        softnessOverride !== undefined
            ? softnessToRadius(softnessOverride, CONFIG.lighting.shadows.pcfRadius)
            : settings.radius;
    bindShadow(shadow as SoftLightShadow, settings, radius);
}

/**
 * Live softness (0–1). Updates `shadow.radius` / `pcssLightSize` on every bound
 * map — the TSL graph already `reference()`s those fields, so no recode.
 */
export function setShadowSoftness(softness: number): ShadowSoftnessState {
    const cfg = CONFIG.lighting.shadows;
    const next = clampSoftness(softness);
    cfg.softness = next;
    const radius = softnessToRadius(next, cfg.pcfRadius);
    for (const bound of _bound) {
        bound.radius = radius;
    }
    return publishState();
}

/** Live PCSS light-size. No-op on a hard (1-tap) kernel. */
export function setShadowPcssEnabled(enabled: boolean): ShadowSoftnessState {
    const cfg = CONFIG.lighting.shadows;
    cfg.pcssEnabled = enabled;
    const size = enabled ? clampSoftness(cfg.pcssLightSize) : 0;
    for (const bound of _bound) {
        bound.pcssLightSize = size;
    }
    return publishState();
}

export function getShadowSoftnessState(): ShadowSoftnessState {
    const cfg = CONFIG.lighting.shadows;
    const softness = clampSoftness(cfg.softness);
    return {
        softness,
        radius: softnessToRadius(softness, cfg.pcfRadius),
        kernel: _kernel,
        pcssEnabled: (_bound[0]?.pcssLightSize ?? 0) > 0,
        pcssLightSize: _bound[0]?.pcssLightSize ?? 0,
        tapsPerCascade: shadowFilterTapCount(_kernel),
        cascades: _cascades,
    };
}

function publishState(): ShadowSoftnessState {
    const state = getShadowSoftnessState();
    try {
        if (typeof window !== 'undefined') {
            window.__shadowSoftness = state;
        }
    } catch {
        /* non-browser */
    }
    return state;
}
