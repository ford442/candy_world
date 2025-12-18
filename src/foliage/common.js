import * as THREE from 'three';
import { color, mix, positionLocal, float, time, sin, cos, vec3, uniform } from 'three/tsl';
import { MeshStandardNodeMaterial, MeshPhysicalNodeMaterial } from 'three/webgpu';
import { fbm, isEmscriptenReady } from '../utils/wasm-loader.js';

// --- Global Uniforms ---
export const uWindSpeed = uniform(1.0);
export const uWindDirection = uniform(new THREE.Vector3(1, 0, 0));

// --- Reusable Objects ---
export const _foliageReactiveColor = new THREE.Color();
export const eyeGeo = new THREE.SphereGeometry(0.05, 16, 16);
export const reactiveMaterials = [];

export function registerReactiveMaterial(mat) {
    if (reactiveMaterials.length < 500) {
        reactiveMaterials.push(mat);
    }
}

// --- Reactivity Mixin ---
export function attachReactivity(group) {
    // Optimization: Cache reactive meshes to avoid expensive scene graph traversal on every note trigger
    const reactiveMeshes = [];
    group.traverse((child) => {
        if (child.isMesh && child.material) {
            // Support both single material and material arrays
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of materials) {
                if (mat && mat.emissive) {
                    reactiveMeshes.push(child);
                    break; // Child is reactive if at least one material is reactive
                }
            }
        }
    });

    group.reactToNote = function(note, colorHex, velocity = 1.0) {
        const targetColor = new THREE.Color(colorHex);

        for (let i = 0, l = reactiveMeshes.length; i < l; i++) {
            const child = reactiveMeshes[i];
            // Since we cached the child, we know it has userData (all Object3D do)
            child.userData.flashColor = targetColor;
            child.userData.flashIntensity = 1.0 * velocity;
            child.userData.flashDecay = 0.05;
        }

        if (group.userData.animationType) {
            group.userData.animationOffset += 0.5;
        }
    };
    return group;
}

// --- Helper: Rim Lighting Effect ---
export function addRimLight(material, colorHex) {
    // Placeholder for rim lighting logic
}

// --- Helper to pick random animation ---
export function pickAnimation(types) {
    return types[Math.floor(Math.random() * types.length)];
}

// --- Texture Generation ---
let globalNoiseTexture = null;

export function generateNoiseTexture() {
    if (globalNoiseTexture) return globalNoiseTexture;

    const size = 256;
    const data = new Uint8Array(size * size * 4);
    const useWasm = isEmscriptenReady();

    for (let i = 0; i < size * size; i++) {
        const x = (i % size) / size;
        const y = Math.floor(i / size) / size;

        let n = 0;
        if (useWasm) {
            n = fbm(x * 4.0, y * 4.0, 4);
            n = n * 0.5 + 0.5;
        } else {
            n = Math.random();
        }

        const val = Math.floor(n * 255);
        data[i * 4] = val;
        data[i * 4 + 1] = val;
        data[i * 4 + 2] = val;
        data[i * 4 + 3] = 255;
    }

    globalNoiseTexture = new THREE.DataTexture(data, size, size);
    globalNoiseTexture.wrapS = THREE.RepeatWrapping;
    globalNoiseTexture.wrapT = THREE.RepeatWrapping;
    globalNoiseTexture.needsUpdate = true;
    return globalNoiseTexture;
}

// --- Material Creators ---
export function createClayMaterial(colorHex) {
    if (!globalNoiseTexture) generateNoiseTexture();
    return new THREE.MeshStandardMaterial({
        color: colorHex,
        metalness: 0.0,
        roughness: 0.8,
        flatShading: false,
        bumpMap: globalNoiseTexture,
        bumpScale: 0.02
    });
}

export function createCandyMaterial(colorHex, glossiness = 0.7) {
    if (!globalNoiseTexture) generateNoiseTexture();
    return new THREE.MeshPhysicalMaterial({
        color: colorHex,
        metalness: 0.0,
        roughness: Math.max(0.1, 0.3 - glossiness * 0.1),
        clearcoat: 0.4 + glossiness * 0.4,
        clearcoatRoughness: 0.2,
        flatShading: false,
        bumpMap: globalNoiseTexture,
        bumpScale: 0.01
    });
}

export function createGradientMaterial(topColorHex, bottomColorHex, roughnessVal = 0.7) {
    const mat = new MeshStandardNodeMaterial();
    mat.roughness = roughnessVal;
    mat.metalness = 0;

    const h = positionLocal.y.add(0.5).clamp(0, 1);
    const topCol = color(topColorHex);
    const bottomCol = color(bottomColorHex);
    mat.colorNode = mix(bottomCol, topCol, h);

    return mat;
}

// --- Material Collections ---
export const foliageMaterials = {
    grass: createClayMaterial(0x7CFC00),
    flowerStem: createClayMaterial(0x228B22),
    flowerCenter: createCandyMaterial(0xFFFACD, 0.5),
    flowerPetal: [
        createCandyMaterial(0xFF69B4, 0.8),
        createCandyMaterial(0xBA55D3, 0.8),
        createCandyMaterial(0x87CEFA, 0.7),
    ],
    lightBeam: new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    }),
    blackPlastic: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.1 }),
    lotusRing: createClayMaterial(0x222222),
    opticCable: new THREE.MeshStandardMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.3,
        roughness: 0.1
    }),
    opticTip: new THREE.MeshBasicMaterial({ color: 0xFFFFFF }),
    mushroomStem: createClayMaterial(0xF5DEB3),
    mushroomCap: [
        createCandyMaterial(0xFF6347, 0.9),
        createCandyMaterial(0xDA70D6, 0.9),
        createCandyMaterial(0xFFA07A, 0.8),
        createCandyMaterial(0x00BFFF, 1.0),
    ],
    mushroomGills: createClayMaterial(0x8B4513),
    mushroomSpots: createCandyMaterial(0xFFFFFF, 0.6),
    eye: new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1 }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 }),
};
