import type { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { createUnifiedMaterial, type UnifiedMaterialOptions } from './unified-material.ts';

type PresetFn = (
    hex: number | string | import('three').Color,
    opts?: UnifiedMaterialOptions
) => MeshPhysicalNodeMaterial;

export const CandyPresets: { [key: string]: PresetFn } = {
    Clay: (hex, opts = {}) =>
        createUnifiedMaterial(hex, {
            roughness: 0.8,
            bumpStrength: 0.15,
            noiseScale: 8.0,
            triplanar: true,
            contactDarkening: 0.3,
            contactDarkeningHeight: 1.0,
            rimStrength: 0.3,
            rimPower: 3.0,
            ...opts,
        }),

    Sugar: (hex, opts = {}) =>
        createUnifiedMaterial(hex, {
            roughness: 0.6,
            bumpStrength: 0.8,
            noiseScale: 60.0,
            sheen: 1.0,
            sheenColor: 0xffffff,
            sheenRoughness: 0.5,
            contactDarkening: 0.2,
            contactDarkeningHeight: 0.8,
            ...opts,
        }),

    Gummy: (hex, opts = {}) =>
        createUnifiedMaterial(hex, {
            transmission: 0.9,
            thickness: 1.5,
            roughness: 0.2,
            ior: 1.4,
            subsurfaceStrength: 0.6,
            subsurfaceColor: hex,
            thicknessDistortion: 0.3,
            contactDarkening: 0.2,
            contactDarkeningHeight: 1.0,
            ...opts,
        }),

    SeaJelly: (hex, opts = {}) =>
        createUnifiedMaterial(hex, {
            transmission: 0.95,
            thickness: 0.8,
            ior: 1.33,
            roughness: 0.05,
            subsurfaceStrength: 0.4,
            subsurfaceColor: 0xccffff,
            animateMoisture: true,
            thicknessDistortion: 0.5,
            ...opts,
        }),

    Crystal: (hex, opts = {}) =>
        createUnifiedMaterial(hex, {
            transmission: 1.0,
            thickness: 4.0,
            roughness: 0.0,
            ior: 2.0,
            iridescenceStrength: 0.7,
            iridescenceFresnelPower: 2.5,
            ...opts,
        }),

    Velvet: (hex, opts = {}) =>
        createUnifiedMaterial(hex, {
            roughness: 1.0,
            sheen: 1.0,
            sheenColor: hex,
            sheenRoughness: 1.0,
            bumpStrength: 0.05,
            ...opts,
        }),

    OilSlick: (hex = 0x222222, opts = {}) =>
        createUnifiedMaterial(hex, {
            roughness: 0.3,
            metalness: 0.8,
            iridescenceStrength: 1.0,
            iridescenceFresnelPower: 1.5,
            ...opts,
        }),
};
