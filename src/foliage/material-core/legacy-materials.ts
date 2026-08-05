import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color,
    float,
    vec3,
    mix,
    uv,
    sin,
    positionLocal,
    positionWorld,
} from 'three/tsl';
import { CandyPresets } from './presets.ts';
import { createUnifiedMaterial, type UnifiedMaterialOptions } from './unified-material.ts';
import { uTime, uWindSpeed, uWindDirection } from './shared-resources.ts';
import { calculatePlayerPush } from './deformation.ts';

export function createClayMaterial(
    hexColor: number | string | THREE.Color,
    opts: UnifiedMaterialOptions = {}
) {
    return CandyPresets.Clay(hexColor, opts);
}

export function createCandyMaterial(
    hexColor: number | string | THREE.Color,
    opts: UnifiedMaterialOptions = {}
) {
    return CandyPresets.Gummy(hexColor, opts);
}

export function createTexturedClay(hexColor: number | string | THREE.Color, options: any = {}) {
    return createUnifiedMaterial(hexColor, {
        roughness: options.roughness || 0.6,
        bumpStrength: options.bumpStrength || 0.1,
        noiseScale: options.noiseScale || 5.0,
        triplanar: true,
    });
}

export function createSugaredMaterial(hexColor: number | string | THREE.Color, options: any = {}) {
    return createUnifiedMaterial(hexColor, {
        roughness: 0.5,
        bumpStrength: 0.6,
        noiseScale: options.crystalScale || 50.0,
        sheen: 1.0,
        sheenColor: 0xffffff,
        subsurfaceStrength: options.subsurface || 0.2,
    });
}

export function createGradientMaterial(
    colorBottom: number | string | THREE.Color,
    colorTop: number | string | THREE.Color,
    roughness = 0.9
) {
    const windTime = uTime.mul(uWindSpeed.add(0.5));
    const swayPhase = positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.5)).add(windTime);
    const swayAmount = sin(swayPhase).mul(0.1).mul(uWindSpeed.add(0.2));

    const heightFactor = positionLocal.y.max(0.0);

    const windBend = vec3(
        uWindDirection.x.mul(swayAmount).mul(heightFactor.pow(2.0)),
        float(0.0),
        uWindDirection.z.mul(swayAmount).mul(heightFactor.pow(2.0))
    );

    const pushOffset = calculatePlayerPush(positionLocal);

    const totalDeformation = positionLocal.add(windBend).add(pushOffset);

    const gradientNode = mix(color(colorBottom), color(colorTop), uv().y);

    return createUnifiedMaterial(colorBottom, {
        colorNode: gradientNode,
        deformationNode: totalDeformation,
        roughness: roughness,
        bumpStrength: 0.2,
        noiseScale: 4.0,
        triplanar: true,
        metalness: 0.0,
        rimStrength: 0.3,
        rimPower: 3.0,
    });
}

export function createStandardNodeMaterial(options: any = {}) {
    const mat = new MeshStandardNodeMaterial();
    if (options.color !== undefined) mat.colorNode = color(options.color);
    if (options.roughness !== undefined) mat.roughnessNode = float(options.roughness);
    if (options.metalness !== undefined) mat.metalnessNode = float(options.metalness);
    if (options.emissive !== undefined) mat.emissiveNode = color(options.emissive);
    if (options.emissiveIntensity !== undefined && options.emissive !== undefined) {
        mat.emissiveNode = color(options.emissive).mul(float(options.emissiveIntensity));
    }

    if (options.transparent) mat.transparent = true;
    if (options.opacity !== undefined) mat.opacity = options.opacity;
    if (options.side !== undefined) mat.side = options.side;
    if (options.blending !== undefined) mat.blending = options.blending;
    if (options.depthWrite !== undefined) mat.depthWrite = options.depthWrite;

    return mat;
}

export function createTransparentNodeMaterial(options: any = {}) {
    const mat = createStandardNodeMaterial(options);
    mat.transparent = true;
    mat.depthWrite = options.depthWrite !== undefined ? options.depthWrite : false;
    return mat;
}
