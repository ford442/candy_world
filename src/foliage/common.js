import * as THREE from 'three';
import { color, mix, positionLocal, float, time, sin, cos, vec3, uniform } from 'three/tsl';
import { MeshStandardNodeMaterial, MeshPhysicalNodeMaterial } from 'three/webgpu';
import { CONFIG } from '../core/config.js';
import { fbm, isEmscriptenReady } from '../utils/wasm-loader.js';

// --- Global Uniforms ---
export const uWindSpeed = uniform(1.0);
export const uWindDirection = uniform(new THREE.Vector3(1, 0, 0));

// --- Reusable Objects ---
export const _foliageReactiveColor = new THREE.Color();
export const eyeGeo = new THREE.SphereGeometry(0.05, 16, 16);
export const reactiveMaterials = [];
export const reactiveObjects = [];
let reactivityCounter = 0;

export function registerReactiveMaterial(mat) {
    if (reactiveMaterials.length < 500) {
        reactiveMaterials.push(mat);
    }
}

export function cleanupReactivity(group) {
    const idx = reactiveObjects.indexOf(group);
    if (idx !== -1) {
        reactiveObjects.splice(idx, 1);
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

    // Expose cached reactive meshes for efficient per-frame updates
    group.userData.reactiveMeshes = reactiveMeshes; 

    // Setup Split-Channel Reactivity Data
    if (!group.userData.reactivityType) {
        group.userData.reactivityType = 'flora'; // Default
    }
    // Round-robin assignment
    group.userData.reactivityId = reactivityCounter++;

    // Register
    reactiveObjects.push(group);

    group.reactToNote = function(note, colorHex, velocity = 1.0) {
        const targetColor = new THREE.Color(colorHex);

        // Track recent note velocities for per-species smoothing (e.g., mushrooms)
        group.userData.noteBuffer = group.userData.noteBuffer || [];
        pushLimitedBuffer(group.userData.noteBuffer, velocity, CONFIG.reactivity?.mushroom?.medianWindow || 5);

        for (let i = 0, l = reactiveMeshes.length; i < l; i++) {
            const child = reactiveMeshes[i];
            // Since we cached the child, we know it has userData (all Object3D do)
            child.userData.flashColor = targetColor;
            child.userData.flashIntensity = 1.0 * velocity;
            child.userData.flashDecay = 0.05;
        }

        // Debug logging of the note/color mapping (toggle with CONFIG.debugNoteReactivity)
        if (CONFIG.debugNoteReactivity) {
            try {
                console.log('reactToNote:', group.userData.type, 'note=', note, 'color=', targetColor.getHexString(), 'velocity=', velocity);
            } catch (e) { console.log('reactToNote debug error', e); }
        }

        if (group.userData.animationType) {
            group.userData.animationOffset += 0.5;
        }
    }; 
    return group;
}

export function cleanupReactivity(object) {
    const index = reactiveObjects.indexOf(object);
    if (index > -1) {
        reactiveObjects.splice(index, 1);
    }
}

// --- Helper: Rim Lighting Effect ---
export function addRimLight(material, colorHex) {
    // Placeholder for rim lighting logic
}

// --- Helper to pick random animation ---
export function pickAnimation(types) {
    return types[Math.floor(Math.random() * types.length)];
}

// --- Small helpers for reactivity buffers ---
export function pushLimitedBuffer(buf, val, maxLen = 5) {
    buf.push(val);
    while (buf.length > maxLen) buf.shift();
}

export function median(arr) {
    if (!arr || arr.length === 0) return 0;
    const s = arr.slice().sort((a,b)=>a-b);
    const m = Math.floor(s.length / 2);
    return (s.length % 2) ? s[m] : (s[m-1] + s[m]) * 0.5;
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
