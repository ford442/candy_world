// src/foliage/common.js

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, uv, mix, vec3, Fn, uniform, dot, max } from 'three/tsl';

// --- Shared Resources & Geometries ---
// We use "Unit" geometries (size 1) and scale them in the mesh to save memory/draw calls
export const sharedGeometries = {
    unitSphere: new THREE.SphereGeometry(1, 16, 16),
    unitCylinder: new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0), // Pivot at bottom
    unitCone: new THREE.ConeGeometry(1, 1, 16).translate(0, 0.5, 0), // Pivot at bottom
    quad: new THREE.PlaneGeometry(1, 1),

    // Common convenience aliases used throughout the foliage factories
    sphere: new THREE.SphereGeometry(1, 16, 16),
    sphereLow: new THREE.SphereGeometry(1, 8, 8),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0),
    cylinderLow: new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0),
    capsule: new THREE.CapsuleGeometry(0.5, 1, 6, 8),

    // Specific legacy ones (kept for compatibility)
    eye: new THREE.SphereGeometry(0.12, 16, 16),
    pupil: new THREE.SphereGeometry(0.05, 12, 12)
};

// Aliases for legacy code
export const eyeGeo = sharedGeometries.eye;
export const pupilGeo = sharedGeometries.pupil;

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

// Helper to create a MeshStandardNodeMaterial behaving like MeshStandardMaterial
export function createStandardNodeMaterial(options = {}) {
    const mat = new MeshStandardNodeMaterial();
    if (options.color !== undefined) mat.colorNode = color(options.color);
    if (options.roughness !== undefined) mat.roughnessNode = float(options.roughness);
    if (options.metalness !== undefined) mat.metalnessNode = float(options.metalness);
    if (options.emissive !== undefined) mat.emissiveNode = color(options.emissive);
    if (options.emissiveIntensity !== undefined && options.emissive !== undefined) {
         mat.emissiveNode = color(options.emissive).mul(float(options.emissiveIntensity));
    }
    
    // Explicitly copy standard properties
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

// TSL Function for Node usage (not a material modifier function)
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

// Helper for DoubleSide
function createDoubleSideMat(hexColor) {
    const m = new MeshStandardNodeMaterial({ color: hexColor, roughness: 0.4 });
    m.side = THREE.DoubleSide;
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
    
    // --- Specific Materials ---
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
    
    // Fiber Optic Willow
    opticCable: new MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.4 }),
    opticTip: new MeshStandardNodeMaterial({ 
        color: 0xFFFFFF, 
        emissive: 0xFF00FF, 
        emissiveIntensity: 1.0,
        roughness: 0.2 
    }),

    mushroomStem: new MeshStandardNodeMaterial({ color: 0xF5F5DC, roughness: 0.9 }),
    mushroomCap: [
        createClayMaterial(0xFF6B6B), // Pastel Red
        createClayMaterial(0xFF9F43), // Pastel Orange
        createClayMaterial(0xFDCB6E), // Pastel Yellow
        createClayMaterial(0x54A0FF), // Pastel Blue
    ],
    mushroomCheek: createClayMaterial(0xFFAACC), // Pink Cheeks
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
    mouth: new MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.8 }),
    clayMouth: createClayMaterial(0x2D3436) // Dark Grey Clay for Mouth
};

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

// Safety check helper
export function validateFoliageMaterials() {
    const required = ['lightBeam', 'opticTip', 'lotusRing', 'flowerStem'];
    let safe = true;
    required.forEach(key => {
        if (!foliageMaterials[key]) {
            console.error(`[Foliage] Missing material: ${key}. Using fallback.`);
            // Hot Pink Fallback
            foliageMaterials[key] = new MeshStandardNodeMaterial({ color: 0xFF00FF });
            safe = false;
        }
    });
    return safe;
}

// Helper to validate geometries for TSL usage
export function validateNodeGeometries(scene) {
    // Aggregate warnings to avoid spamming the console when many small geometries are missing attributes.
    const missingPosition = [];

    function inferVertexCount(geo) {
        if (!geo) return 0;
        if (geo.index) return geo.index.count;
        let maxCount = 0;
        for (const key in geo.attributes) {
            if (Object.prototype.hasOwnProperty.call(geo.attributes, key)) {
                const a = geo.attributes[key];
                if (a && a.count > maxCount) maxCount = a.count;
            }
        }
        return maxCount;
    }

    function getObjectPath(obj) {
        const parts = [];
        let cur = obj;
        while (cur) {
            const name = cur.name || cur.type || cur.uuid;
            parts.unshift(name);
            cur = cur.parent;
        }
        return parts.join('/') || obj.uuid;
    }

    scene.traverse(obj => {
        if (obj.isMesh || obj.isPoints) {
            const geo = obj.geometry;
            if (geo) {
                // Attempt to auto-patch a missing position attribute when we can infer a vertex count.
                if (!geo.attributes.position) {
                    const preAttrKeys = Object.keys(geo.attributes || {}).join(', ') || '(none)';
                    const inferred = inferVertexCount(geo);
                    if (inferred > 0) {
                        const positions = new Float32Array(inferred * 3);
                        // Leave positions at 0,0,0 to avoid creating unexpected geometry – this is just to satisfy TSL's attribute checks
                        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                        // Do NOT warn in this case; we patched it automatically
                    } else {
                        // Couldn't infer a count — try to create a minimal single-vertex attribute at the object's world position
                        try {
                            const worldPos = new THREE.Vector3();
                            obj.getWorldPosition(worldPos);
                            const positions = new Float32Array(3);
                            positions[0] = worldPos.x; positions[1] = worldPos.y; positions[2] = worldPos.z;
                            geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

                            // Also provide a default normal to satisfy NormalNode
                            const normals = new Float32Array(3);
                            normals[0] = 0; normals[1] = 1; normals[2] = 0;
                            geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

                            // Mark as auto-patched for debugging
                            obj.userData._patchedByValidate = true;

                            // Record as patched (but include when reporting)
                            const name = obj.name || 'Unnamed';
                            const type = obj.userData?.type || 'Unknown Type';
                            const attrKeys = Object.keys(geo.attributes || {}).join(', ') || '(none)';
                            const geoType = geo.type || geo.constructor?.name || 'UnknownGeo';
                            // Find nearest ancestor with a meaningful userData.type to aid mapping back to factories
                        let anc = obj.parent;
                        let ancestorType = null;
                        let ancestorName = null;
                        let depth = 0;
                        while (anc && depth < 10) {
                            if (anc.userData && anc.userData.type) {
                                ancestorType = anc.userData.type;
                                ancestorName = anc.name || anc.userData.type;
                                break;
                            }
                            anc = anc.parent;
                            depth++;
                        }
                        missingPosition.push({ name, type, obj, geoType, attrKeys, path: getObjectPath(obj), patched: true, ancestorType, ancestorName, preAttrKeys });
                        } catch (err) {
                            const name = obj.name || 'Unnamed';
                            const type = obj.userData?.type || 'Unknown Type';
                            const attrKeys = Object.keys(geo.attributes || {}).join(', ') || '(none)';
                            const geoType = geo.type || geo.constructor?.name || 'UnknownGeo';
                            missingPosition.push({ name, type, obj, geoType, attrKeys, path: getObjectPath(obj), preAttrKeys });
                        }
                    }
                }

                // Ensure normals exist for TSL in a non-spammy way
                if (!geo.attributes.normal) {
                    const count = geo.attributes.position ? geo.attributes.position.count : inferVertexCount(geo);
                    if (count > 0) {
                        const normals = new Float32Array(count * 3);
                        for (let i = 0; i < count * 3; i += 3) { normals[i] = 0; normals[i + 1] = 1; normals[i + 2] = 0; }
                        geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
                    }
                }
            }
        }
    });

    if (missingPosition.length > 0) {
        const header = `[TSL] ${missingPosition.length} geometries missing 'position' attribute.`;
        const examples = missingPosition.slice(0, 10).map(m => `${m.path} -> ${m.name}(${m.type}) [${m.geoType}] attrs: ${m.attrKeys}${m.patched ? ' (patched)' : ''}${m.ancestorType ? ` ancestor:${m.ancestorType}` : ''}`);
        const patchedCount = missingPosition.filter(m => m.patched).length;
        const more = missingPosition.length > 10 ? ` + ${missingPosition.length - 10} more` : '';
        let msg = `${header} Examples: ${examples.join('; ')}${more}.`;
        if (patchedCount > 0) {
            msg += ` Note: ${patchedCount} were auto-patched with minimal position/normal data; consider fixing the source constructor.`;
        }
        msg += ' To fix, ensure these geometries set a `position` attribute before adding to the scene.';
        console.warn(msg);

        // Extra diagnostics: print a short table for the first patched items to help locate factories
        const patched = missingPosition.filter(m => m.patched);
        if (patched.length > 0) {
            console.group('[TSL] Patched geometry diagnostics (first 20):');
            patched.slice(0, 20).forEach(m => {
                const mat = m.obj.material;
                const matInfo = mat ? (mat.type || mat.constructor?.name || 'Material') : 'none';
                console.warn(`- ${m.path} -> ${m.name} [${m.geoType}] ancestor:${m.ancestorType || '(none)'} attrs:${m.attrKeys} mat:${matInfo}`);
            });
            console.groupEnd();
        }
    }
}
