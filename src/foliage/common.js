// src/foliage/common.js

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, texture, uv, positionLocal, sin, time, mix, vec3, vec4, Fn, uniform, normalize, dot, max } from 'three/tsl';

// --- Shared Resources ---
export const eyeGeo = new THREE.SphereGeometry(0.12, 16, 16);
export const pupilGeo = new THREE.SphereGeometry(0.05, 12, 12);

// --- Reactive Objects Registry (New System) ---
export const reactiveObjects = [];
let reactivityCounter = 0; // For round-robin channel assignment

// --- Legacy Registry (Fixes animation.js error) ---
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

// --- TSL Helper: Clay Material ---
export function createClayMaterial(hexColor) {
    const mat = new MeshStandardNodeMaterial();
    mat.colorNode = color(hexColor);
    mat.roughnessNode = float(0.8);
    mat.metalnessNode = float(0.0);
    return mat;
}

// --- TSL Helper: Gradient Material ---
export function createGradientMaterial(colorBottom, colorTop) {
    const mat = new MeshStandardNodeMaterial();
    const gradientNode = mix(color(colorBottom), color(colorTop), uv().y);
    mat.colorNode = gradientNode;
    mat.roughnessNode = float(0.9);
    mat.metalnessNode = float(0.0);
    return mat;
}

// --- TSL Helper: Noise Texture ---
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

// --- TSL Helper: Rim Light ---
export const addRimLight = Fn(([baseColorNode, normalNode, viewDirNode]) => {
    const rimPower = float(3.0);
    const rimIntensity = float(0.5);
    const NdotV = max(0.0, dot(normalNode, viewDirNode));
    const rim = float(1.0).sub(NdotV).pow(rimPower).mul(rimIntensity);
    return baseColorNode.add(rim);
});

// --- Material Definitions ---
export const foliageMaterials = {
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
    trunk: new MeshStandardNodeMaterial({ color: 0x8B4513, roughness: 0.9 }),
    flowerPetal: [
        new MeshStandardNodeMaterial({ color: 0xFF69B4, roughness: 0.4, side: THREE.DoubleSide }),
        new MeshStandardNodeMaterial({ color: 0xFFD700, roughness: 0.4, side: THREE.DoubleSide }),
        new MeshStandardNodeMaterial({ color: 0xFFFFFF, roughness: 0.4, side: THREE.DoubleSide }),
    ],
    eye: new MeshStandardNodeMaterial({ color: 0xFFFFFF, roughness: 0.2 }),
    pupil: new MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.0 }),
    mouth: new MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.8 })
};

export function registerReactiveMaterial(mat) {
    // Legacy support: add to both lists just in case
    reactiveMaterials.push(mat);
}

export function pickAnimation(types) {
    return types[Math.floor(Math.random() * types.length)];
}

/**
 * attachReactivity
 * Registers an object for Music Reactivity.
 */
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

/**
 * cleanupReactivity
 * Removes an object from the reactive list.
 */
export function cleanupReactivity(object) {
    const index = reactiveObjects.indexOf(object);
    if (index > -1) {
        reactiveObjects.splice(index, 1);
    }
}
