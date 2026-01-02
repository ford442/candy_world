// src/foliage/common.js

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, uv, mix, vec3, Fn, uniform, dot, max, min,
    mx_noise_float, mx_fractal_noise_float, positionLocal, positionWorld, normalWorld,
    cameraPosition, sin, pow, abs, normalize, dFdx, dFdy, smoothstep, exp,
    cross, vec2, vec4,
    mul, add, sub, div // Added functional operators
} from 'three/tsl';

import { uGlitchIntensity, applyGlitch } from './glitch.js';
export { uGlitchIntensity, applyGlitch };

// --- Shared Resources & Geometries ---
export const sharedGeometries = {
    unitSphere: new THREE.SphereGeometry(1, 16, 16),
    unitCylinder: new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0), // Pivot at bottom
    unitCone: new THREE.ConeGeometry(1, 1, 16).translate(0, 0.5, 0), // Pivot at bottom
    quad: new THREE.PlaneGeometry(1, 1),

    // Common convenience aliases
    sphere: new THREE.SphereGeometry(1, 16, 16),
    sphereLow: new THREE.SphereGeometry(1, 8, 8),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0),
    cylinderLow: new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0),
    capsule: new THREE.CapsuleGeometry(0.5, 1, 6, 8),
    eye: new THREE.SphereGeometry(0.12, 16, 16),
    pupil: new THREE.SphereGeometry(0.05, 12, 12)
};

export const eyeGeo = sharedGeometries.eye;
export const pupilGeo = sharedGeometries.pupil;

// --- Development Mode Validation ---
const DEV_MODE = true; // Set to false for production

// Helper to validate TSL nodes during development
function validateTSLNode(node, context = '') {
    if (!DEV_MODE) return;
    
    if (!node) return;
    
    // Check if trying to use THREE.js object directly as a node
    if (node.isVector2 || node.isVector3 || node.isVector4 || node.isColor) {
        console.error(`[TSL Validation] ${context}: THREE.js object (${node.constructor.name}) used directly. Use uniform() to wrap it or appropriate TSL constructor.`);
        console.trace();
    }
    
    // Check if node has required methods
    if (node.isNode && !node.getNodeType && !node.isUniformNode) {
        console.warn(`[TSL Validation] ${context}: Node missing getNodeType() method. Type: ${node.type || node.constructor?.name}`);
    }
}

// Wrapper for material creation with validation
export function createValidatedMaterial(MaterialClass, options, debugName = 'Unknown') {
    const mat = new MaterialClass(options);
    
    if (DEV_MODE && mat.isNodeMaterial) {
        // Validate critical node properties
        const slots = ['colorNode', 'positionNode', 'normalNode', 'emissiveNode', 'opacityNode'];
        slots.forEach(slot => {
            if (mat[slot]) {
                validateTSLNode(mat[slot], `${debugName}.${slot}`);
            }
        });
    }
    
    return mat;
}

// --- Reactive Objects Registry ---
export const reactiveObjects = [];
let reactivityCounter = 0; 
export const reactiveMaterials = []; 
export const _foliageReactiveColor = new THREE.Color(); 
export const uWindSpeed = uniform(0.0);
export const uWindDirection = uniform(new THREE.Vector3(1, 0, 0));
export const uTime = uniform(0.0); 

export function median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

// --- TSL UTILITY FUNCTIONS ---

export const triplanarNoise = Fn((pos, scale) => {
    const p = mul(pos, scale);
    const n = abs(normalWorld);

    // FIX: float(0.0)
    const noiseX = mx_noise_float(vec3(p.y, p.z, float(0.0)));
    const noiseY = mx_noise_float(vec3(p.x, p.z, float(0.0)));
    const noiseZ = mx_noise_float(vec3(p.x, p.y, float(0.0)));

    const nSum = add(n.x, n.y).add(n.z);
    const blend = div(n, nSum);

    const termX = mul(noiseX, blend.x);
    const termY = mul(noiseY, blend.y);
    const termZ = mul(noiseZ, blend.z);

    return add(termX, termY).add(termZ);
});

export const perturbNormal = Fn((pos, normal, scale, strength) => {
    const eps = float(0.01);
    const s = scale;

    const n0 = mx_noise_float(mul(pos, s));

    // FIX: float(0.0)
    const posX = mul(add(pos, vec3(eps, float(0.0), float(0.0))), s);
    const nX = mx_noise_float(posX);

    const posY = mul(add(pos, vec3(float(0.0), eps, float(0.0))), s);
    const nY = mx_noise_float(posY);

    const posZ = mul(add(pos, vec3(float(0.0), float(0.0), eps)), s);
    const nZ = mx_noise_float(posZ);

    const dx = div(sub(nX, n0), eps);
    const dy = div(sub(nY, n0), eps);
    const dz = div(sub(nZ, n0), eps);

    const noiseGrad = vec3(dx, dy, dz);
    const perturbed = normalize(sub(normal, mul(noiseGrad, strength)));
    return perturbed;
});

export const addRimLight = Fn((baseColorNode, normalNode, viewDirNode) => {
    const rimPower = float(3.0);
    const rimIntensity = float(0.5);
    // FIX: max(float(0.0), ...) to prevent TypeErrors
    const NdotV = max(float(0.0), dot(normalNode, viewDirNode));
    const rim = mul(pow(sub(float(1.0), NdotV), rimPower), rimIntensity);
    return add(baseColorNode, rim);
});

// --- UNIFIED MATERIAL PIPELINE ---

export function createUnifiedMaterial(hexColor, options = {}) {
    const {
        roughness = 0.5,
        metalness = 0.0,
        bumpStrength = 0.0,
        noiseScale = 5.0,
        triplanar = false,    
        side = THREE.FrontSide, 
        transmission = 0.0,    
        thickness = 0.0,      
        ior = 1.5,             
        thicknessDistortion = 0.0,
        subsurfaceStrength = 0.0,
        subsurfaceColor = 0xFFFFFF,
        iridescenceStrength = 0.0,
        iridescenceFresnelPower = 4.0,
        sheen = 0.0,
        sheenColor = 0xFFFFFF,
        sheenRoughness = 1.0,
        animateMoisture = false,
        animatePulse = false
    } = options;

    const material = new MeshStandardNodeMaterial();

    material.colorNode = color(hexColor);
    material.roughnessNode = float(roughness);
    material.metalnessNode = float(metalness);
    material.side = side;

    let surfaceNoise = float(0.0);

    if (bumpStrength > 0.0 || thicknessDistortion > 0.0 || animateMoisture) {
        let pos = positionLocal;
        if (animateMoisture) {
            // FIX: float(0.0)
            const timeOffset = vec3(float(0.0), uTime.mul(float(0.2)), float(0.0));
            pos = pos.add(timeOffset);
        }

        if (triplanar) {
            surfaceNoise = triplanarNoise(pos, float(noiseScale));
        } else {
            surfaceNoise = mx_noise_float(pos.mul(float(noiseScale)));
        }
    }

    if (bumpStrength > 0.0) {
        material.normalNode = perturbNormal(positionLocal, normalWorld, float(noiseScale), float(bumpStrength));
        // FIX: float() for smoothstep
        const cavity = smoothstep(float(0.3), float(0.7), surfaceNoise);
        material.colorNode = material.colorNode.mul(cavity.mul(float(0.5)).add(float(0.5)));
    }

    const glitchRes = applyGlitch(uv(), material.positionNode || positionLocal, uGlitchIntensity);
    material.positionNode = glitchRes.position;

    const glitchTint = vec3(float(1.0), float(0.0), float(1.0));
    // FIX: float()
    const glitchMix = smoothstep(float(0.1), float(0.3), uGlitchIntensity).mul(float(0.5));
    material.colorNode = mix(material.colorNode, glitchTint, glitchMix);

    if (animateMoisture) {
        const wetness = surfaceNoise.mul(float(0.3));
        material.roughnessNode = material.roughnessNode.sub(wetness);
    }

    if (transmission > 0.0) {
        material.transmissionNode = float(transmission);
        material.iorNode = float(ior);
        material.transparent = true;

        let thickNode = float(thickness);
        if (thicknessDistortion > 0.0) {
            thickNode = thickNode.mul(surfaceNoise.mul(float(thicknessDistortion)).add(float(1.0)));
        }
        material.thicknessNode = thickNode;

        const absorption = exp(thickNode.negate().mul(float(0.5)));
        material.colorNode = material.colorNode.mul(absorption.add(float(0.2)));
    }

    if (subsurfaceStrength > 0.0) {
        const lightDir = normalize(vec3(float(0.5), float(1.0), float(0.5)));
        const NdotL = dot(normalWorld, lightDir);
        const wrap = float(1.0).sub(max(float(0.0), NdotL)).pow(float(2.0)); 

        const sssColorNode = color(subsurfaceColor);
        const sssEffect = wrap.mul(float(subsurfaceStrength)).mul(sssColorNode);
        material.colorNode = material.colorNode.add(sssEffect);
    }

    if (iridescenceStrength > 0.0) {
        const viewDir = normalize(cameraPosition.sub(positionWorld));
        const NdotV = abs(dot(normalWorld, viewDir));
        const fresnel = float(1.0).sub(NdotV).pow(float(iridescenceFresnelPower));

        const irisR = sin(fresnel.mul(float(10.0)));
        const irisG = sin(fresnel.mul(float(10.0)).add(float(2.0)));
        const irisB = sin(fresnel.mul(float(10.0)).add(float(4.0)));

        const rainbow = vec3(irisR, irisG, irisB).mul(float(0.5)).add(float(0.5));
        material.emissiveNode = rainbow.mul(float(iridescenceStrength)).mul(fresnel);
    }

    if (animatePulse) {
        const pulse = sin(uTime.mul(float(3.0))).mul(float(0.2)).add(float(0.8));
        material.emissiveNode = (material.emissiveNode || color(0x000000)).add(material.colorNode.mul(pulse.mul(float(0.2))));
    }

    if (sheen > 0.0) {
        material.sheen = sheen;
        material.sheenColorNode = color(sheenColor);
        material.sheenRoughnessNode = float(sheenRoughness);
    }

    material.userData.isUnified = true;
    return material;
}

export const CandyPresets = {
    Clay: (hex, opts={}) => createUnifiedMaterial(hex, {
        roughness: 0.8,
        bumpStrength: 0.15,
        noiseScale: 8.0,
        triplanar: true,
        ...opts
    }),
    Sugar: (hex, opts={}) => createUnifiedMaterial(hex, {
        roughness: 0.6,
        bumpStrength: 0.8,
        noiseScale: 60.0, 
        sheen: 1.0,
        sheenColor: 0xFFFFFF,
        sheenRoughness: 0.5,
        ...opts
    }),
    Gummy: (hex, opts={}) => createUnifiedMaterial(hex, {
        transmission: 0.9,
        thickness: 1.5,
        roughness: 0.2,
        ior: 1.4,
        subsurfaceStrength: 0.6,
        subsurfaceColor: hex,
        thicknessDistortion: 0.3,
        ...opts
    }),
    SeaJelly: (hex, opts={}) => createUnifiedMaterial(hex, {
        transmission: 0.95,
        thickness: 0.8,
        ior: 1.33,
        roughness: 0.05,
        subsurfaceStrength: 0.4,
        subsurfaceColor: 0xCCFFFF,
        animateMoisture: true, 
        thicknessDistortion: 0.5,
        ...opts
    }),
    Crystal: (hex, opts={}) => createUnifiedMaterial(hex, {
        transmission: 1.0,
        thickness: 4.0,
        roughness: 0.0,
        ior: 2.0, 
        iridescenceStrength: 0.7,
        iridescenceFresnelPower: 2.5,
        ...opts
    }),
    Velvet: (hex, opts={}) => createUnifiedMaterial(hex, {
        roughness: 1.0,
        sheen: 1.0,
        sheenColor: hex, 
        sheenRoughness: 1.0,
        bumpStrength: 0.05,
        ...opts
    }),
    OilSlick: (hex=0x222222, opts={}) => createUnifiedMaterial(hex, {
        roughness: 0.3,
        metalness: 0.8,
        iridescenceStrength: 1.0,
        iridescenceFresnelPower: 1.5,
        ...opts
    })
};

export function createClayMaterial(hexColor) {
    return CandyPresets.Clay(hexColor);
}

export function createCandyMaterial(hexColor) {
    return CandyPresets.Gummy(hexColor);
}

export function createTexturedClay(hexColor, options={}) {
    return createUnifiedMaterial(hexColor, {
        roughness: options.roughness || 0.6,
        bumpStrength: options.bumpStrength || 0.1,
        noiseScale: options.noiseScale || 5.0,
        triplanar: true
    });
}

export function createSugaredMaterial(hexColor, options={}) {
    return createUnifiedMaterial(hexColor, {
        roughness: 0.5,
        bumpStrength: 0.6,
        noiseScale: options.crystalScale || 50.0,
        sheen: 1.0,
        sheenColor: 0xFFFFFF,
        subsurfaceStrength: options.subsurface || 0.2
    });
}

export function createGradientMaterial(colorBottom, colorTop) {
    const mat = new MeshStandardNodeMaterial();
    const gradientNode = mix(color(colorBottom), color(colorTop), uv().y);
    mat.colorNode = gradientNode;
    mat.roughnessNode = float(0.9);
    mat.metalnessNode = float(0.0);
    return mat;
}

export function createStandardNodeMaterial(options = {}) {
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

export function createTransparentNodeMaterial(options = {}) {
    const mat = createStandardNodeMaterial(options);
    mat.transparent = true;
    mat.depthWrite = options.depthWrite !== undefined ? options.depthWrite : false; 
    return mat;
}

export const foliageMaterials = {
    stem: CandyPresets.Clay(0x66AA55),
    flowerCenter: CandyPresets.Velvet(0x442211),
    vine: CandyPresets.Clay(0x558833),
    wood: createUnifiedMaterial(0x8B4513, { roughness: 0.9, bumpStrength: 0.3, noiseScale: 3.0 }),
    leaf: createUnifiedMaterial(0x228B22, { roughness: 0.6, side: THREE.DoubleSide, bumpStrength: 0.1 }),
    
    flowerStem: CandyPresets.Clay(0x66AA55),
    lotusRing: CandyPresets.Gummy(0xFFFFFF),
    opticCable: createUnifiedMaterial(0x111111, { roughness: 0.4 }),
    opticTip: createStandardNodeMaterial({
        color: 0xFFFFFF,
        emissive: 0xFF00FF,
        emissiveIntensity: 1.0,
        roughness: 0.2
    }),

    lightBeam: new MeshStandardNodeMaterial({ 
        color: 0xFFFFFF, 
        transparent: true, 
        opacity: 0.2, 
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        roughness: 1.0 
    }),
    
    mushroomStem: CandyPresets.Clay(0xF5F5DC),

    mushroomCap: [
        CandyPresets.Clay(0xFF6B6B),        
        CandyPresets.Gummy(0xFF9F43),       
        CandyPresets.Sugar(0xFDCB6E),       
        CandyPresets.Crystal(0x54A0FF),     
        CandyPresets.OilSlick()             
    ],

    mushroomCheek: CandyPresets.Velvet(0xFFAACC),
    mushroomGills: CandyPresets.Clay(0x332211, { side: THREE.DoubleSide }),
    mushroomSpots: CandyPresets.Sugar(0xFFFFFF),

    flowerPetal: [
        CandyPresets.Velvet(0xFF69B4, { side: THREE.DoubleSide }),
        CandyPresets.Gummy(0xFFD700, { side: THREE.DoubleSide }),
        CandyPresets.Crystal(0xFFFFFF, { side: THREE.DoubleSide }),
        CandyPresets.Sugar(0x9933FF, { side: THREE.DoubleSide }),
    ],

    eye: CandyPresets.Gummy(0xFFFFFF), 
    pupil: new MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.0 }),
    mouth: CandyPresets.Clay(0x2D3436),
    clayMouth: CandyPresets.Clay(0x2D3436)
};

export function registerReactiveMaterial(mat) { reactiveMaterials.push(mat); }
export function pickAnimation(types) { return types[Math.floor(Math.random() * types.length)]; }

export function attachReactivity(group, options = {}) {
    reactiveObjects.push(group);
    group.userData.reactivityType = options.type || group.userData.reactivityType || 'flora';
    if (typeof group.userData.reactivityId === 'undefined') group.userData.reactivityId = reactivityCounter++;
    const light = options.lightPreference || {};
    group.userData.minLight = (typeof light.min !== 'undefined') ? light.min : (group.userData.minLight ?? 0.0);
    group.userData.maxLight = (typeof light.max !== 'undefined') ? light.max : (group.userData.maxLight ?? 1.0);
    return group;
}

export function cleanupReactivity(object) {
    const index = reactiveObjects.indexOf(object);
    if (index > -1) reactiveObjects.splice(index, 1);
}

export function validateFoliageMaterials() {
    const required = ['lightBeam', 'mushroomCap', 'opticTip', 'lotusRing', 'flowerStem'];
    let safe = true;
    required.forEach(key => {
        if (!foliageMaterials[key]) {
            console.error(`[Foliage] Missing material: ${key}. Using fallback.`);
            foliageMaterials[key] = new MeshStandardNodeMaterial({ color: 0xFF00FF });
            safe = false;
        }
    });
    return safe;
}

export function validateNodeGeometries(scene) {
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
                if (!geo.attributes.position) {
                    const preAttrKeys = Object.keys(geo.attributes || {}).join(', ') || '(none)';
                    const inferred = inferVertexCount(geo);
                    if (inferred > 0) {
                        const positions = new Float32Array(inferred * 3);
                        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                    } else {
                        try {
                            const worldPos = new THREE.Vector3();
                            obj.getWorldPosition(worldPos);
                            const positions = new Float32Array(3);
                            positions[0] = worldPos.x; positions[1] = worldPos.y; positions[2] = worldPos.z;
                            geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

                            const normals = new Float32Array(3);
                            normals[0] = 0; normals[1] = 1; normals[2] = 0;
                            geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

                            obj.userData._patchedByValidate = true;

                            const name = obj.name || 'Unnamed';
                            const type = obj.userData?.type || 'Unknown Type';
                            const attrKeys = Object.keys(geo.attributes || {}).join(', ') || '(none)';
                            const geoType = geo.type || geo.constructor?.name || 'UnknownGeo';

                            let anc = obj.parent;
                            let ancestorType = null;
                            let ancestorName = null;
                            let depth = 0;
                            while (anc && depth < 10) {
                                if (anc && anc.userData && anc.userData.type) {
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
        console.warn(msg);
    }
}
