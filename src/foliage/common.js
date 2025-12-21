// src/foliage/common.js

import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { color, float, texture, uv, positionLocal, sin, time, mix, vec3, vec4, Fn, uniform, normalize, dot, max } from 'three/tsl';

// --- Shared Resources ---
export const eyeGeo = new THREE.SphereGeometry(0.12, 16, 16);
export const pupilGeo = new THREE.SphereGeometry(0.05, 12, 12);

export const sharedGeometries = {
    sphere: new THREE.SphereGeometry(1, 16, 16),
    sphereLow: new THREE.SphereGeometry(1, 8, 8),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 16),
    cylinderLow: new THREE.CylinderGeometry(1, 1, 1, 8),
    box: new THREE.BoxGeometry(1, 1, 1),
    capsule: new THREE.CapsuleGeometry(1, 1, 4, 16)
};

// --- Reactive Objects Registry ---
export const reactiveObjects = [];
let reactivityCounter = 0; 

// --- Legacy Registry ---
export const reactiveMaterials = []; 
export const _foliageReactiveColor = new THREE.Color(); 
export function median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// --- Global Uniforms ---
export const uWindSpeed = uniform(0.0);
export const uWindDirection = uniform(vec3(1, 0, 0));

// --- TSL Helpers ---
export function createClayMaterial(hexColor) {
    const mat = new MeshStandardNodeMaterial();
    mat.colorNode = color(hexColor);
    mat.roughnessNode = float(0.8);
    mat.metalnessNode = float(0.0);
    return mat;
}

export function createCandyMaterial(hexColor) {
    const mat = new MeshStandardNodeMaterial();
    mat.colorNode = color(hexColor);
    mat.roughnessNode = float(0.15); 
    mat.metalnessNode = float(0.1);  
    return mat;
}

export function createGradientMaterial(colorBottom, colorTop) {
    const mat = new MeshStandardNodeMaterial();
    const gradientNode = mix(color(colorBottom), color(colorTop), uv().y);
    mat.colorNode = gradientNode;
    mat.roughnessNode = float(0.9);
    mat.metalnessNode = float(0.0);
    return mat;
}

export function generateNoiseTexture(size = 256) {
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size * 4; i++) {
        data[i] = Math.random() * 255;
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

export const addRimLight = Fn(([baseColorNode, normalNode, viewDirNode]) => {
    const rimPower = float(3.0);
    const rimIntensity = float(0.5);
    const NdotV = max(0.0, dot(normalNode, viewDirNode));
    const rim = float(1.0).sub(NdotV).pow(rimPower).mul(rimIntensity);
    return baseColorNode.add(rim);
});

// --- Material Definitions ---
const trunkMat = new MeshStandardNodeMaterial({ color: 0x8B4513, roughness: 0.9 });
const vineMat = new MeshStandardNodeMaterial({ color: 0x558833, roughness: 0.7 });

export const foliageMaterials = {
    // --- Generic / Aliases ---
    stem: new MeshStandardNodeMaterial({ color: 0x66AA55, roughness: 0.8 }),
    flowerCenter: new MeshStandardNodeMaterial({ color: 0x442211, roughness: 0.9 }),
    vine: vineMat, 
    wood: trunkMat,
    bark: trunkMat,
    trunk: trunkMat,
    petal: new MeshStandardNodeMaterial({ color: 0xFF69B4, roughness: 0.4, side: THREE.DoubleSide }), 
    
    // --- Missing Definitions Fixed Here ---
    lightBeam: new MeshStandardNodeMaterial({ 
        color: 0xFFFFFF, 
        transparent: true, 
        opacity: 0.2, 
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        roughness: 1.0 
    }),
    flowerStem: new MeshStandardNodeMaterial({ color: 0x66AA55, roughness: 0.8 }),
    lotusRing: new MeshStandardNodeMaterial({ color: 0xFFFFFF, roughness: 0.2 }),
    
    // Fix for fiber_optic_willow
    opticCable: new MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.4 }),
    opticTip: new MeshStandardNodeMaterial({ 
        color: 0xFFFFFF, 
        emissive: 0xFF00FF, 
        emissiveIntensity: 1.0,
        roughness: 0.2 
    }),

    // --- Specific Materials ---
    mushroomStem: new MeshStandardNodeMaterial({ color: 0xF5F5DC, roughness: 0.9 }),
    mushroomCap: [
        new MeshStandardNodeMaterial({ color: 0xFF0000, roughness: 0.3 }), 
        new MeshStandardNodeMaterial({ color: 0x0000FF, roughness: 0.3 }), 
        new MeshStandardNodeMaterial({ color: 0x00FF00, roughness: 0.3 }), 
        new MeshStandardNodeMaterial({ color: 0xFFFF00, roughness: 0.3 }), 
    ],
    mushroomGills: new MeshStandardNodeMaterial({ color: 0x332211, roughness: 1.0, side: THREE.DoubleSide }),
    mushroomSpots: new MeshStandardNodeMaterial({ color: 0xFFFFFF, roughness: 0.8 }),
    leaf: new MeshStandardNodeMaterial({ color: 0x228B22, roughness: 0.6, side: THREE.DoubleSide }),
    flowerPetal: [
        new MeshStandardNodeMaterial({ color: 0xFF69B4, roughness: 0.4, side: THREE.DoubleSide }), 
        new MeshStandardNodeMaterial({ color: 0xFFD700, roughness: 0.4, side: THREE.DoubleSide }), 
        new MeshStandardNodeMaterial({ color: 0xFFFFFF, roughness: 0.4, side: THREE.DoubleSide }), 
        new MeshStandardNodeMaterial({ color: 0x9933FF, roughness: 0.4, side: THREE.DoubleSide }), 
    ],
    eye: new MeshStandardNodeMaterial({ color: 0xFFFFFF, roughness: 0.2 }),
    pupil: new MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.0 }),
    mouth: new MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.8 })
};

export function validateFoliageMaterials(requiredKeys = []) {
    let hasError = false;
    const missingKeys = [];

    // Common keys that should always exist (Updated with specific materials)
    const defaultKeys = [
        'stem', 'flowerCenter', 'vine', 'wood', 'petal',
        'lightBeam', 'opticTip', 'flowerStem', 'opticCable',
        'mushroomStem', 'eye', 'pupil', 'mouth'
    ];
    const allKeys = new Set([...defaultKeys, ...requiredKeys]);

    allKeys.forEach(key => {
        if (!foliageMaterials[key]) {
            hasError = true;
            missingKeys.push(key);
            console.error(`[Material Validation] Missing material: ${key}. Injecting Hot Pink fallback.`);

            // Inject Hot Pink Fallback
            foliageMaterials[key] = new MeshBasicNodeMaterial({
                color: 0xFF00FF // Hot Pink
            });
        }
    });

    if (hasError) {
        console.warn(`[Material Validation] Validation failed for: ${missingKeys.join(', ')}. Check console for details.`);
    } else {
        console.log(`[Material Validation] All ${allKeys.size} required materials verified.`);
    }
}

export function registerReactiveMaterial(mat) {
    reactiveMaterials.push(mat);
}

export function pickAnimation(types) {
    return types[Math.floor(Math.random() * types.length)];
}

export function attachReactivity(group, options = {}) {
    reactiveObjects.push(group);
    group.userData.reactivityType = options.type || group.userData.reactivityType || 'flora';

    if (typeof group.userData.reactivityId === 'undefined') {
        group.userData.reactivityId = reactivityCounter++;
    }

    const light = options.lightPreference || {};
    group.userData.minLight = (typeof light.min !== 'undefined') ? light.min : (group.userData.minLight ?? 0.0);
    group.userData.maxLight = (typeof light.max !== 'undefined') ? light.max : (group.userData.maxLight ?? 1.0);

    return group;
}

export function cleanupReactivity(object) {
    const index = reactiveObjects.indexOf(object);
    if (index > -1) {
        reactiveObjects.splice(index, 1);
    }
}
