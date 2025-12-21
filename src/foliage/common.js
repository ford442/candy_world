// src/foliage/common.js

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, texture, uv, positionLocal, sin, time, mix, vec3, vec4, Fn } from 'three/tsl';

// --- Shared Resources ---
export const eyeGeo = new THREE.SphereGeometry(0.12, 16, 16);
export const pupilGeo = new THREE.SphereGeometry(0.05, 12, 12);

// --- Reactive Objects Registry ---
export const reactiveObjects = [];
let reactivityCounter = 0; // For round-robin channel assignment

export const foliageMaterials = {
    mushroomStem: new MeshStandardNodeMaterial({ color: 0xF5F5DC, roughness: 0.9 }),
    mushroomCap: [
        new MeshStandardNodeMaterial({ color: 0xFF0000, roughness: 0.3 }), // Red
        new MeshStandardNodeMaterial({ color: 0x0000FF, roughness: 0.3 }), // Blue
        new MeshStandardNodeMaterial({ color: 0x00FF00, roughness: 0.3 }), // Green
        new MeshStandardNodeMaterial({ color: 0xFFFF00, roughness: 0.3 }), // Yellow
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
    // Legacy support or placeholder if needed
}

export function pickAnimation(types) {
    return types[Math.floor(Math.random() * types.length)];
}

/**
 * attachReactivity
 * Registers an object for Music Reactivity.
 * * @param {THREE.Object3D} group - The object to register.
 * @param {Object} options - Config options.
 * @param {String} options.type - 'flora' or 'sky'.
 * @param {Object} options.lightPreference - { min: 0.0, max: 1.0 }.
 */
export function attachReactivity(group, options = {}) {
    // 1. Register to the central list
    reactiveObjects.push(group);

    // 2. Set Reactivity Type (flora vs sky)
    group.userData.reactivityType = options.type || group.userData.reactivityType || 'flora';

    // 3. Assign Reactivity ID (Round-Robin)
    // This ensures objects don't all listen to channel 0
    if (typeof group.userData.reactivityId === 'undefined') {
        group.userData.reactivityId = reactivityCounter++;
    }

    // 4. Set Light Preference (Photosensitivity)
    // Default to always reactive (0.0 - 1.0) unless specified
    const light = options.lightPreference || {};
    group.userData.minLight = (typeof light.min !== 'undefined') ? light.min : (group.userData.minLight ?? 0.0);
    group.userData.maxLight = (typeof light.max !== 'undefined') ? light.max : (group.userData.maxLight ?? 1.0);

    return group;
}

/**
 * cleanupReactivity
 * Removes an object from the reactive list to prevent memory leaks.
 */
export function cleanupReactivity(object) {
    const index = reactiveObjects.indexOf(object);
    if (index > -1) {
        reactiveObjects.splice(index, 1);
    }
}
