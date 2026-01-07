// src/foliage/common.js

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, uv, mix, vec3, Fn, uniform, dot, max, min,
    mx_noise_float, mx_fractal_noise_float, positionLocal, positionWorld, normalWorld,
    cameraPosition, sin, pow, abs, normalize, dFdx, dFdy, smoothstep, exp,
    cross, vec2, vec4
} from 'three/tsl';

import { applyGlitch } from './glitch.js';

// --- Shared Resources & Geometries ---
// We use "Unit" geometries (size 1) and scale them in the mesh to save memory/draw calls
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

// --- Reactive Objects Registry ---
export const reactiveObjects = [];
let reactivityCounter = 0; 
export const reactiveMaterials = []; 
export const _foliageReactiveColor = new THREE.Color(); 
export const uWindSpeed = uniform(0.0);
export const uWindDirection = uniform(vec3(1, 0, 0));
export const uTime = uniform(0.0); // Global time uniform for animated materials
export const uGlitchIntensity = uniform(0.0); // Global glitch intensity
export const uAudioLow = uniform(0.0);   // Bass energy (Kick)
export const uAudioHigh = uniform(0.0);  // Treble energy (Hi-hats/Cymbals)

// --- UTILITY FUNCTIONS ---

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

/**
 * Generates triplanar noise to avoid UV seams on complex geometry.
 */
export const triplanarNoise = Fn(([pos, scale]) => {
    const p = pos.mul(scale);
    const n = abs(normalWorld);

    // Sample noise on three planes
    const noiseX = mx_noise_float(vec3(p.y, p.z, 0.0));
    const noiseY = mx_noise_float(vec3(p.x, p.z, 0.0));
    const noiseZ = mx_noise_float(vec3(p.x, p.y, 0.0));

    // Blend based on normal facing
    const blend = n.div(n.x.add(n.y).add(n.z));
    return noiseX.mul(blend.x).add(noiseY.mul(blend.y)).add(noiseZ.mul(blend.z));
});

/**
 * Calculates a perturbed normal using finite difference of a noise function.
 * This creates real physical bumps that react to light.
 */
export const perturbNormal = Fn(([pos, normal, scale, strength]) => {
    const eps = float(0.01);
    const s = scale;

    // Sample noise at offsets
    const n0 = mx_noise_float(pos.mul(s));
    const nX = mx_noise_float(pos.add(vec3(eps, 0.0, 0.0)).mul(s));
    const nY = mx_noise_float(pos.add(vec3(0.0, eps, 0.0)).mul(s));
    const nZ = mx_noise_float(pos.add(vec3(0.0, 0.0, eps)).mul(s));

    // Calculate gradients
    const dx = nX.sub(n0).div(eps);
    const dy = nY.sub(n0).div(eps);
    const dz = nZ.sub(n0).div(eps);

    // Perturb original normal
    const noiseGrad = vec3(dx, dy, dz);
    // Project gradient onto surface tangent plane roughly
    const perturbed = normalize(normal.sub(noiseGrad.mul(strength)));
    return perturbed;
});

/**
 * Creates a TSL node for Rim Light (Fresnel-like edge glow).
 * @param {Node} colorNode - Color of the rim light
 * @param {float|Node} intensity - Intensity multiplier
 * @param {float|Node} power - Sharpness of the rim (higher = thinner)
 * @param {Node} [normalNode] - Optional normal override (defaults to normalWorld)
 * @returns {Node} - The calculated emission color node
 */
export const createRimLight = Fn(([colorNode, intensity, power, normalNode]) => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    // Use supplied normal or default to global world normal
    const N = normalNode || normalWorld;

    // NdotV can be negative if back-facing, but rim light usually wraps.
    // However, strictly it's dot(N, V).
    const NdotV = abs(dot(N, viewDir));
    const rim = float(1.0).sub(NdotV).pow(power);
    return colorNode.mul(rim).mul(intensity);
});

// Legacy helper kept for compatibility
export const addRimLight = Fn(([baseColorNode, normalNode]) => {
    // Pass the normalNode if it exists
    return baseColorNode.add(createRimLight(color(0xFFFFFF), float(0.5), float(3.0), normalNode));
});

// --- UNIFIED MATERIAL PIPELINE ---

/**
 * Creates a highly configurable procedural material using TSL.
 * Supports: Micro-bumps, Transmission, SSS, Iridescence, Sheen, and Animation.
 */
export function createUnifiedMaterial(hexColor, options = {}) {
    const {
        // Surface Basics
        roughness = 0.5,
        metalness = 0.0,
        bumpStrength = 0.0,
        noiseScale = 5.0,
        triplanar = false,      // Use triplanar mapping for bumps?
        side = THREE.FrontSide, // Render side

        // Translucency (Glass / Jelly)
        transmission = 0.0,     // 0.0 to 1.0
        thickness = 0.0,        // Physical thickness
        ior = 1.5,              // Refraction index
        thicknessDistortion = 0.0,

        // Subsurface Scattering (Gummy / Wax)
        subsurfaceStrength = 0.0,
        subsurfaceColor = 0xFFFFFF,

        // Iridescence (Oil / Magic)
        iridescenceStrength = 0.0,
        iridescenceFresnelPower = 4.0,

        // Sheen (Velvet / Frosting)
        sheen = 0.0,
        sheenColor = 0xFFFFFF,
        sheenRoughness = 1.0,

        // Animation
        animateMoisture = false,
        animatePulse = false
    } = options;

    const material = new MeshStandardNodeMaterial();

    // 1. Base Properties
    material.colorNode = color(hexColor);
    material.roughnessNode = float(roughness);
    material.metalnessNode = float(metalness);
    material.side = side;

    // 2. Procedural Surface Noise (Micro-geometry)
    let surfaceNoise = float(0.0);

    if (bumpStrength > 0.0 || thicknessDistortion > 0.0 || animateMoisture) {
        // Handle animation time offset
        let pos = positionLocal;
        if (animateMoisture) {
            // Slide noise over surface for wet look
            const timeOffset = vec3(0.0, uTime.mul(0.2), 0.0);
            pos = pos.add(timeOffset);
        }

        if (triplanar) {
            surfaceNoise = triplanarNoise(pos, float(noiseScale));
        } else {
            surfaceNoise = mx_noise_float(pos.mul(float(noiseScale)));
        }
    }

    if (bumpStrength > 0.0) {
        // Apply True Normal Perturbation
        material.normalNode = perturbNormal(positionLocal, normalWorld, float(noiseScale), float(bumpStrength));

        // Cavity AO: Darken crevices (low noise values)
        const cavity = smoothstep(0.3, 0.7, surfaceNoise);
        // Mix base color with darker version based on cavity
        material.colorNode = material.colorNode.mul(cavity.mul(0.5).add(0.5));
    }

    if (animateMoisture) {
        // Vary roughness with noise to look like flowing water/slime
        const wetness = surfaceNoise.mul(0.3);
        material.roughnessNode = material.roughnessNode.sub(wetness); // Wet = smoother
    }

    // 3. Translucency & Thickness (Beer-Lambert Approximation)
    if (transmission > 0.0) {
        material.transmissionNode = float(transmission);
        material.iorNode = float(ior);
        material.transparent = true;

        // Thickness modulation
        let thickNode = float(thickness);
        if (thicknessDistortion > 0.0) {
            thickNode = thickNode.mul(surfaceNoise.mul(thicknessDistortion).add(1.0));
        }
        material.thicknessNode = thickNode;

        // Absorb color based on thickness (Beer's Law simulation)
        // Deeper parts absorb more light, shifting color
        const absorption = exp(thickNode.negate().mul(0.5));
        material.colorNode = material.colorNode.mul(absorption.add(0.2));
    }

    // 4. Simulated Subsurface Scattering (Back-lighting)
    if (subsurfaceStrength > 0.0) {
        // Simplified overhead light direction for static SSS calculation
        const lightDir = normalize(vec3(0.5, 1.0, 0.5));

        // Wrap lighting: light bleeds around the object
        // 1.0 when facing away from light (backlit), 0.0 when facing light
        const NdotL = dot(normalWorld, lightDir);
        const wrap = float(1.0).sub(max(0.0, NdotL)).pow(2.0); // Soft wrap curve

        const sssColorNode = color(subsurfaceColor);
        // Add glow to base color
        const sssEffect = wrap.mul(subsurfaceStrength).mul(sssColorNode);
        material.colorNode = material.colorNode.add(sssEffect);
    }

    // 5. Iridescence (Thin-Film Interference approximation)
    if (iridescenceStrength > 0.0) {
        const viewDir = normalize(cameraPosition.sub(positionWorld));
        const NdotV = abs(dot(normalWorld, viewDir));

        // Fresnel: Stronger at edges
        const fresnel = float(1.0).sub(NdotV).pow(float(iridescenceFresnelPower));

        // Spectral shift (Rainbow)
        // Offset phases for R, G, B to create spectrum
        const irisR = sin(fresnel.mul(10.0));
        const irisG = sin(fresnel.mul(10.0).add(2.0));
        const irisB = sin(fresnel.mul(10.0).add(4.0));

        const rainbow = vec3(irisR, irisG, irisB).mul(0.5).add(0.5);

        // Add as emissive (glows)
        material.emissiveNode = rainbow.mul(iridescenceStrength).mul(fresnel);
    }

    // 6. Pulse Animation
    if (animatePulse) {
        const pulse = sin(uTime.mul(3.0)).mul(0.2).add(0.8); // 0.6 to 1.0
        material.emissiveNode = (material.emissiveNode || color(0x000000)).add(material.colorNode.mul(pulse.mul(0.2)));
    }

    // 7. Sheen
    if (sheen > 0.0) {
        material.sheen = sheen;
        material.sheenColorNode = color(sheenColor);
        material.sheenRoughnessNode = float(sheenRoughness);
    }

    // 8. Global Glitch Effect (Sample Offset / Pixelation)
    // We apply this last to affect the final position.
    // Compose with existing positionNode if it exists (e.g. from Wind or animation), otherwise use positionLocal.
    const basePos = material.positionNode || positionLocal;
    const glitchRes = applyGlitch(uv(), basePos, uGlitchIntensity);

    // Override position with glitched version
    material.positionNode = glitchRes.position;

    // We can also affect UVs for texture lookups if we had textures.
    // Since most materials here are procedural noise, we could pass glitched UV/Position to noise functions
    // but noise usually takes position.

    // Let's make sure the glitch affects the material color if it uses UVs (like gradients)
    // But since we are mostly noise based on position...
    // The vertex displacement `material.positionNode` handles the shape distortion.

    material.userData.isUnified = true;
    return material;
}

// --- PRESETS (The "Beauty" Collection) ---

export const CandyPresets = {
    // 1. Standard Clay: Tactile, slightly bumpy, matte
    Clay: (hex, opts={}) => createUnifiedMaterial(hex, {
        roughness: 0.8,
        bumpStrength: 0.15,
        noiseScale: 8.0,
        triplanar: true,
        ...opts
    }),

    // 2. Sugared: Frosted look with high sheen and micro-bumps
    Sugar: (hex, opts={}) => createUnifiedMaterial(hex, {
        roughness: 0.6,
        bumpStrength: 0.8,
        noiseScale: 60.0, // High freq for crystals
        sheen: 1.0,
        sheenColor: 0xFFFFFF,
        sheenRoughness: 0.5,
        ...opts
    }),

    // 3. Gummy: Translucent, inner glow, soft
    Gummy: (hex, opts={}) => createUnifiedMaterial(hex, {
        transmission: 0.9,
        thickness: 1.5,
        roughness: 0.2,
        ior: 1.4,
        subsurfaceStrength: 0.6,
        subsurfaceColor: hex, // Self-colored glow
        thicknessDistortion: 0.3,
        ...opts
    }),

    // 4. Sea Jelly: Wobbly, wet, very translucent
    SeaJelly: (hex, opts={}) => createUnifiedMaterial(hex, {
        transmission: 0.95,
        thickness: 0.8,
        ior: 1.33,
        roughness: 0.05,
        subsurfaceStrength: 0.4,
        subsurfaceColor: 0xCCFFFF,
        animateMoisture: true, // Appears wet/flowing
        thicknessDistortion: 0.5,
        ...opts
    }),

    // 5. Enchanted Crystal: High refraction + Iridescence
    Crystal: (hex, opts={}) => createUnifiedMaterial(hex, {
        transmission: 1.0,
        thickness: 4.0,
        roughness: 0.0,
        ior: 2.0, // Diamond-like
        iridescenceStrength: 0.7,
        iridescenceFresnelPower: 2.5,
        ...opts
    }),

    // 6. Velvet Frosting: Soft, no specular, high sheen
    Velvet: (hex, opts={}) => createUnifiedMaterial(hex, {
        roughness: 1.0,
        sheen: 1.0,
        sheenColor: hex, // Colored sheen
        sheenRoughness: 1.0,
        bumpStrength: 0.05,
        ...opts
    }),

    // 7. Oil Slick: Dark base, rainbow edges
    OilSlick: (hex=0x222222, opts={}) => createUnifiedMaterial(hex, {
        roughness: 0.3,
        metalness: 0.8,
        iridescenceStrength: 1.0,
        iridescenceFresnelPower: 1.5,
        ...opts
    })
};

// --- LEGACY WRAPPERS (Backward Compatibility) ---

export function createClayMaterial(hexColor) {
    return CandyPresets.Clay(hexColor);
}

export function createCandyMaterial(hexColor) {
    return CandyPresets.Gummy(hexColor); // Upgrade old candy to Gummy
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
    // Wrapper for specific sugar tweaking
    return createUnifiedMaterial(hexColor, {
        roughness: 0.5,
        bumpStrength: 0.6,
        noiseScale: options.crystalScale || 50.0,
        sheen: 1.0,
        sheenColor: 0xFFFFFF,
        subsurfaceStrength: options.subsurface || 0.2
    });
}

// Legacy Gradient Material (Kept as is)
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

// --- MATERIAL DEFINITIONS ---

export const foliageMaterials = {
    // Basic organics
    stem: CandyPresets.Clay(0x66AA55),
    flowerCenter: CandyPresets.Velvet(0x442211),
    vine: CandyPresets.Clay(0x558833),
    wood: createUnifiedMaterial(0x8B4513, { roughness: 0.9, bumpStrength: 0.3, noiseScale: 3.0 }),
    leaf: createUnifiedMaterial(0x228B22, { roughness: 0.6, side: THREE.DoubleSide, bumpStrength: 0.1 }),
    
    // Restored/Upgraded Materials
    flowerStem: CandyPresets.Clay(0x66AA55),
    lotusRing: CandyPresets.Gummy(0xFFFFFF),
    opticCable: createUnifiedMaterial(0x111111, { roughness: 0.4 }),
    opticTip: createStandardNodeMaterial({
        color: 0xFFFFFF,
        emissive: 0xFF00FF,
        emissiveIntensity: 1.0,
        roughness: 0.2
    }),

    // Special Effects
    lightBeam: new MeshStandardNodeMaterial({ 
        color: 0xFFFFFF, 
        transparent: true, 
        opacity: 0.2, 
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        roughness: 1.0 
    }),
    
    mushroomStem: CandyPresets.Clay(0xF5F5DC),

    // Diverse Mushroom Caps
    mushroomCap: [
        CandyPresets.Clay(0xFF6B6B),        // Matte Red
        CandyPresets.Gummy(0xFF9F43),       // Orange Gummy
        CandyPresets.Sugar(0xFDCB6E),       // Sugared Yellow
        CandyPresets.Crystal(0x54A0FF),     // Blue Crystal
        CandyPresets.OilSlick()             // Rare Oil
    ],

    mushroomCheek: CandyPresets.Velvet(0xFFAACC),

    // Upgraded parts
    mushroomGills: CandyPresets.Clay(0x332211, { side: THREE.DoubleSide }),
    mushroomSpots: CandyPresets.Sugar(0xFFFFFF),

    flowerPetal: [
        CandyPresets.Velvet(0xFF69B4, { side: THREE.DoubleSide }),
        CandyPresets.Gummy(0xFFD700, { side: THREE.DoubleSide }),
        CandyPresets.Crystal(0xFFFFFF, { side: THREE.DoubleSide }),
        CandyPresets.Sugar(0x9933FF, { side: THREE.DoubleSide }),
    ],

    // Faces
    eye: CandyPresets.Gummy(0xFFFFFF), // Wet eyes
    pupil: new MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.0 }),
    mouth: CandyPresets.Clay(0x2D3436),
    clayMouth: CandyPresets.Clay(0x2D3436)
};

// --- REACTIVITY & VALIDATION HELPERS ---

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
