// src/foliage/foliage-materials.ts
// Foliage material instances - pre-configured materials for all foliage types

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, vec3, positionLocal, positionWorld, uv, sin, pow, abs, smoothstep } from 'three/tsl';
import {
    CandyPresets,
    createUnifiedMaterial,
    createStandardNodeMaterial,
    calculateWindSway,
    calculateFlowerBloom,
    createJuicyRimLight,
    applyPlayerInteraction,
    uTime,
    uAudioLow,
    uWindSpeed,
    uWindDirection
} from './material-core.ts';
import { mx_noise_float } from 'three/tsl';

// --- MATERIAL DEFINITIONS ---

export const foliageMaterials: { [key: string]: THREE.Material | THREE.Material[] } = {
    // Basic organics
    // PALETTE UPDATE: Apply Interaction + Wind to standard Stem
    stem: (() => {
        const mat = CandyPresets.Clay(0x66AA55);
        // Combine Player Push + Wind Sway
        const withPush = applyPlayerInteraction(positionLocal);
        mat.positionNode = withPush.add(calculateWindSway(positionLocal));

        // 🎨 PALETTE: Add Juicy Rim Light to stem so it pops against dark backgrounds
        const audioRimIntensity = float(1.0).add(uAudioLow.mul(0.5));
        const rimLight = createJuicyRimLight(color(0x66AA55), audioRimIntensity, float(3.0), null);
        mat.emissiveNode = (mat.emissiveNode || color(0x000000)).add(rimLight);

        return mat;
    })(),

    get flowerCenter() { return CandyPresets.Velvet(0x442211, { audioReactStrength: 0.5 }); },
    get vine() { return CandyPresets.Clay(0x558833); },
    get wood() { return createUnifiedMaterial(0x8B4513, { roughness: 0.9, bumpStrength: 0.3, noiseScale: 3.0 }); },
    get leaf() { return createUnifiedMaterial(0x228B22, { roughness: 0.6, side: THREE.DoubleSide, bumpStrength: 0.1 }); },
    
    // Restored/Upgraded Materials
    // PALETTE UPDATE: Apply Interaction + Wind to Flower Stem
    flowerStem: (() => {
        const mat = CandyPresets.Clay(0x66AA55);
        // Combine Player Push + Wind Sway
        const withPush = applyPlayerInteraction(positionLocal);
        mat.positionNode = withPush.add(calculateWindSway(positionLocal));

        // 🎨 PALETTE: Add Juicy Rim Light to flowerStem so it pops against dark backgrounds
        const audioRimIntensity = float(1.0).add(uAudioLow.mul(0.5));
        const rimLight = createJuicyRimLight(color(0x66AA55), audioRimIntensity, float(3.0), null);
        mat.emissiveNode = (mat.emissiveNode || color(0x000000)).add(rimLight);

        return mat;
    })(),

    get lotusRing() { return CandyPresets.Gummy(0xFFFFFF); },
    get opticCable() { return createUnifiedMaterial(0x111111, { roughness: 0.4 }); },
    get opticTip() { return createStandardNodeMaterial({
        color: 0xFFFFFF,
        emissive: 0xFF00FF,
        emissiveIntensity: 1.0,
        roughness: 0.2
    }); },

    // Special Effects
    // PALETTE UPDATE: Volumetric God Ray (TSL)
    lightBeam: (() => {
        const mat = new MeshStandardNodeMaterial({
            color: 0xFFFFFF,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            roughness: 1.0,
            side: THREE.DoubleSide
        });

        // 1. Edge Fade (Cylinder UV x wraps 0..1)
        // Center (0.5) is bright, Edges (0.0/1.0) are transparent
        const beamCore = float(1.0).sub(abs(uv().x.sub(0.5)).mul(2.0));
        const softBeam = smoothstep(0.0, 0.5, beamCore);

        // 2. Vertical Fade (Top/Bottom)
        const verticalFade = smoothstep(0.0, 0.2, uv().y).mul(float(1.0).sub(smoothstep(0.8, 1.0, uv().y)));

        // 3. Dust Motes (Rising Noise)
        const dustSpeed = vec3(0.0, uTime.mul(0.2), 0.0);
        const dustPos = positionLocal.mul(2.0).add(dustSpeed);
        const dust = mx_noise_float(dustPos).mul(0.5).add(0.5); // 0..1

        // 4. Audio Pulse (Breathing)
        const pulse = sin(uTime.mul(2.0)).mul(0.1).add(0.9); // Idle breath
        const audioBoost = uAudioLow.mul(0.5); // Bass boost
        const totalPulse = pulse.add(audioBoost);

        // Combine
        const opacity = softBeam.mul(verticalFade).mul(dust).mul(totalPulse).mul(0.3);

        mat.opacityNode = opacity;
        // Use Node Color (can be overridden by instance color)
        mat.colorNode = color(0xFFFFFF);
        mat.emissiveNode = color(0xFFFFFF).mul(opacity);

        return mat;
    })(),
    
    mushroomStem: (() => {
        const mat = CandyPresets.Clay(0xF5F5DC);
        // ⚡ TSL Shaping: Apply curved profile to standard cylinder
        // Profile: r = 1.0 - (t - 0.3)^2 * 0.5
        const t = positionLocal.y; // unitCylinder is 0..1 in Y
        const curve = float(1.0).sub( pow(t.sub(0.3), 2.0).mul(0.5) );
        const newPos = vec3(positionLocal.x.mul(curve), positionLocal.y, positionLocal.z.mul(curve));

        // PALETTE UPDATE: Apply Interaction to Shaped Stem
        mat.positionNode = applyPlayerInteraction(newPos);

        // Recalculate Normal: N = (x, -r'(y), z) -> (x, y-0.3, z)
        const ny = t.sub(0.3);
        const newNormal = vec3(positionLocal.x, ny, positionLocal.z).normalize();
        mat.normalNode = newNormal;

        // 🎨 PALETTE: Add Juicy Rim Light to mushroomStem so it pops against dark backgrounds
        const audioRimIntensity = float(1.0).add(uAudioLow.mul(0.5));
        const rimLight = createJuicyRimLight(color(0xF5F5DC), audioRimIntensity, float(3.0), mat.normalNode);
        mat.emissiveNode = (mat.emissiveNode || color(0x000000)).add(rimLight);

        return mat;
    })(),

    // Diverse Mushroom Caps
    get mushroomCap() {
        return [
            CandyPresets.Clay(0xFF6B6B),        // Matte Red
            CandyPresets.Gummy(0xFF9F43),       // Orange Gummy
            CandyPresets.Sugar(0xFDCB6E),       // Sugared Yellow
            CandyPresets.Crystal(0x54A0FF),     // Blue Crystal
            CandyPresets.OilSlick()             // Rare Oil
        ];
    },

    get mushroomCheek() { return CandyPresets.Velvet(0xFFAACC); },

    // Upgraded parts
    get mushroomGills() { return CandyPresets.Clay(0x332211, { side: THREE.DoubleSide }); },
    get mushroomSpots() { return CandyPresets.Sugar(0xFFFFFF); },

    get flowerPetal() {
        return [
            CandyPresets.Velvet(0xFF69B4, { side: THREE.DoubleSide, audioReactStrength: 1.0, deformationNode: calculateFlowerBloom(positionLocal) }),
            CandyPresets.Gummy(0xFFD700, { side: THREE.DoubleSide, audioReactStrength: 0.8, deformationNode: calculateFlowerBloom(positionLocal) }),
            CandyPresets.Crystal(0xFFFFFF, { side: THREE.DoubleSide, audioReactStrength: 0.5, deformationNode: calculateFlowerBloom(positionLocal) }),
            CandyPresets.Sugar(0x9933FF, { side: THREE.DoubleSide, audioReactStrength: 1.0, deformationNode: calculateFlowerBloom(positionLocal) }),
        ];
    },

    // Faces
    get eye() { return CandyPresets.Gummy(0xFFFFFF); }, // Wet eyes
    get pupil() { return new MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.0 }); },
    get mouth() { return CandyPresets.Clay(0x2D3436); },
    get clayMouth() { return CandyPresets.Clay(0x2D3436); }
};
