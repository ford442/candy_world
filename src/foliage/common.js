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

// --- Reusable Objects ---
export const _foliageReactiveColor = new THREE.Color();
export const eyeGeo = new THREE.SphereGeometry(0.05, 16, 16);
export const reactiveMaterials = [];
export const reactiveObjects = [];

// --- Legacy Registry ---
export const reactiveMaterials = []; 
export const _foliageReactiveColor = new THREE.Color(); 
export function median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// --- Reactivity Mixin ---
export function attachReactivity(group, options = {}) {
    // Set Light Preferences (default: always reactive)
    group.userData.minLight = options.minLight !== undefined ? options.minLight : 0.0;
    group.userData.maxLight = options.maxLight !== undefined ? options.maxLight : 1.0;

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

    // Add to centralized reactive registry
    // Default to 'flora' type (bottom half of channels)
    group.userData.reactivityType = group.userData.reactivityType || 'flora';
    // Assign a random ID for round-robin channel mapping (0-15 covers typical 32ch tracker files)
    if (typeof group.userData.reactivityId === 'undefined') {
        group.userData.reactivityId = Math.floor(Math.random() * 16);
    }

    reactiveObjects.push(group);

    group.reactToNote = function(note, colorHex, velocity = 1.0) {
        const targetColor = new THREE.Color(colorHex);

        // Track recent note velocities for per-species smoothing (e.g., mushrooms)
        group.userData.noteBuffer = group.userData.noteBuffer || [];
        pushLimitedBuffer(group.userData.noteBuffer, velocity, CONFIG.reactivity?.mushroom?.medianWindow || 5);

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

export function cleanupReactivity(object) {
    const index = reactiveObjects.indexOf(object);
    if (index > -1) {
        reactiveObjects.splice(index, 1);
    }
}

// --- Helper: Rim Lighting Effect ---
export function addRimLight(material, colorHex) {
    // Placeholder for rim lighting logic
// Helper to create a MeshStandardNodeMaterial behaving like MeshStandardMaterial
export function createStandardNodeMaterial(options = {}) {
    const mat = new MeshStandardNodeMaterial();
    if (options.color !== undefined) mat.colorNode = color(options.color);
    if (options.roughness !== undefined) mat.roughnessNode = float(options.roughness);
    if (options.metalness !== undefined) mat.metalnessNode = float(options.metalness);
    if (options.emissive !== undefined) mat.emissiveNode = color(options.emissive);
    // Handle Emissive Intensity manually via node multiplication if needed, or rely on standard prop
    if (options.emissiveIntensity !== undefined) mat.emissiveNode = mat.emissiveNode.mul(float(options.emissiveIntensity));
    
    // Explicitly copy standard properties that shouldn't be nodes
    if (options.transparent) mat.transparent = true;
    if (options.opacity !== undefined) mat.opacity = options.opacity;
    if (options.side !== undefined) mat.side = options.side;
    if (options.blending !== undefined) mat.blending = options.blending;
    if (options.depthWrite !== undefined) mat.depthWrite = options.depthWrite;
    
    return mat;
}

export function createTransparentNodeMaterial(options = {}) {
    const mat = createStandardNodeMaterial(options);
    mat.transparent = true;
    // Fix for Depth Stencil Warning: explicit depthWrite control
    mat.depthWrite = options.depthWrite !== undefined ? options.depthWrite : false; 
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

// Helper to safely create DoubleSide materials
function createDoubleSideMat(hexColor) {
    const m = new MeshStandardNodeMaterial({ color: hexColor, roughness: 0.4 });
    m.side = THREE.DoubleSide; // Set explicitly after construction
    return m;
}

export const foliageMaterials = {
    // --- Generic / Aliases ---
    stem: new MeshStandardNodeMaterial({ color: 0x66AA55, roughness: 0.8 }),
    flowerCenter: new MeshStandardNodeMaterial({ color: 0x442211, roughness: 0.9 }),
    vine: vineMat, 
    wood: trunkMat,
    bark: trunkMat,
    trunk: trunkMat,
    petal: createDoubleSideMat(0xFF69B4), 
    
    // --- Missing Definitions Fixed Here ---
    lightBeam: new MeshStandardNodeMaterial({ 
        color: 0xFFFFFF, 
        transparent: true, 
        opacity: 0.2, 
        blending: THREE.AdditiveBlending,
        depthWrite: false, // Fix depth stencil warning
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
    // Defensive DoubleSide setting for array items or special materials
    mushroomGills: (() => {
        const m = new MeshStandardNodeMaterial({ color: 0x332211, roughness: 1.0 });
        m.side = THREE.DoubleSide;
        return m;
    })(),
    mushroomSpots: new MeshStandardNodeMaterial({ color: 0xFFFFFF, roughness: 0.8 }),
    leaf: (() => {
        const m = new MeshStandardNodeMaterial({ color: 0x228B22, roughness: 0.6 });
        m.side = THREE.DoubleSide;
        return m;
    })(),
    flowerPetal: [
        createDoubleSideMat(0xFF69B4), 
        createDoubleSideMat(0xFFD700), 
        createDoubleSideMat(0xFFFFFF), 
        createDoubleSideMat(0x9933FF), 
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
