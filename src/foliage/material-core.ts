// src/foliage/material-core.ts
// Core material system: shared resources, TSL utilities, and material factory

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, uv, mix, vec3, vec2, Fn, uniform, dot, max, min,
    mx_noise_float, positionLocal, positionWorld, normalWorld, normalLocal,
    cameraPosition, sin, pow, abs, normalize, smoothstep, exp,
    texture, Node, attribute
} from 'three/tsl';

import { applyGlitch } from './glitch.ts';
import { 
    CommonGeometries,
} from '../utils/geometry-dedup.ts';
import { getWindTextureData } from './wind-compute.ts';

// --- Shared Resources & Geometries (Deduplicated via GeometryRegistry) ---
// All geometries are now created through the registry to prevent duplicates
export const sharedGeometries: { [key: string]: THREE.BufferGeometry } = {
    // Unit geometries with pivot at bottom
    get unitSphere() { return CommonGeometries.unitSphere; },
    get unitCylinder() { return CommonGeometries.unitCylinder; },
    get unitCone() { return CommonGeometries.unitCone; },
    get quad() { return CommonGeometries.unitPlane; },

    // Common convenience aliases (deduplicated - these reference the same underlying geometry)
    get sphere() { return CommonGeometries.unitSphere; },  // Same as unitSphere
    get sphereLow() { return CommonGeometries.unitSphereLow; },
    get cylinder() { return CommonGeometries.unitCylinder; },  // Same as unitCylinder
    get cylinderLow() { return CommonGeometries.unitCylinderLow; },
    get capsule() { return CommonGeometries.capsule; },
    get eye() { return CommonGeometries.eye; },
    get pupil() { return CommonGeometries.pupil; },

    // Mushroom parts
    get mushroomCap() { return CommonGeometries.mushroomCap; },
    get mushroomGillCenter() { return CommonGeometries.mushroomGillCenter; },
    get mushroomSmile() { return CommonGeometries.mushroomSmile; },
};

export const eyeGeo = sharedGeometries.eye;
export const pupilGeo = sharedGeometries.pupil;

// --- Scratch Variables (GC Optimization) ---
export const _scratchVec1 = new THREE.Vector3();
export const _scratchVec2 = new THREE.Vector3();
export const _scratchVec3 = new THREE.Vector3();

// --- Global Uniforms ---
export const uWindSpeed = uniform(0.0);
export const uWindDirection = uniform(vec3(1, 0, 0));
export const uTime = uniform(0.0); // Global time uniform for animated materials
export const uGlitchIntensity = uniform(0.0); // Global glitch intensity
export const uGlitchExplosionCenter = uniform(vec3(0, 0, 0)); // Local glitch center
export const uGlitchExplosionRadius = uniform(0.0); // Local glitch radius (0 when inactive)
export const uAudioLow = uniform(0.0);   // Bass energy (Kick)
export const uAudioHigh = uniform(0.0);  // Treble energy (Hi-hats/Cymbals)

// --- PALETTE UPDATE: New Uniforms for Player Interaction ---
export const uPlayerPosition = uniform(vec3(0, 0, 0)); // Player position in world space
// -----------------------------------------------------------

// --- MATERIAL CACHE ---
const materialCache = new Map<string, THREE.Material>();

/**
 * Gets a cached procedural material or creates a new one using the factory function.
 * This prevents duplicate material creation and improves performance.
 */
export function getCachedProceduralMaterial(
    key: string,
    colorHint: number,
    factory: () => THREE.Material
): THREE.Material {
    if (materialCache.has(key)) {
        return materialCache.get(key)!;
    }
    const material = factory();
    materialCache.set(key, material);
    return material;
}

// --- UTILITY FUNCTIONS ---

export function median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function generateNoiseTexture(size = 256): THREE.DataTexture {
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

/**
 * Creates a "Juicy" Rim Light with audio reactivity and color shifting.
 */
export const createJuicyRimLight = Fn(([baseColor, intensity, power, normalNode]) => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const N = normalNode || normalWorld;
    const NdotV = abs(dot(N, viewDir));
    const rim = float(1.0).sub(NdotV).pow(power);

    // 1. Audio Pulse (Juice)
    const pulse = sin(uTime.mul(3.0)).mul(0.2).add(0.8); // 0.6 to 1.0
    const audioBoost = uAudioHigh.mul(2.0); // Boost on high freq (melody)

    // 2. Color Shift (Neon Magic)
    const magicColor = color(0x00FFFF); // Cyan
    // Mix Magic color at the very edge (rim > 0.5) and when audio is loud
    const colorMix = rim.mul(0.5).add(audioBoost.mul(0.2)).min(1.0);
    const finalColor = mix(baseColor, magicColor, colorMix);

    const finalIntensity = intensity.mul(pulse).add(audioBoost);

    return finalColor.mul(rim).mul(finalIntensity);
});

/**
 * Creates a "Sugar Sparkle" effect for candy aesthetics.
 * View-dependent, audio-reactive glitter.
 */
export const createSugarSparkle = Fn(([normalNode, scale, density, intensity]) => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));

    // View-dependent shift: Sparkles "twinkle" as you move around
    // We add the view direction to the noise coordinates so the pattern shifts with the camera angle.
    const noiseCoord = positionLocal.mul(scale).add(viewDir.mul(2.0));

    // High frequency noise for the glitter grains
    const noiseVal = mx_noise_float(noiseCoord);

    // Threshold: Only the peaks of the noise become sparkles.
    // increasing density lowers the threshold (more sparkles).
    // density 0.1 -> threshold 0.9 (few)
    // density 0.5 -> threshold 0.5 (many)
    const threshold = float(1.0).sub(density);

    // Hard cutoff for sharp glitter, or smoothstep for soft glow?
    // Glitter should be sharp.
    const sparkle = smoothstep(threshold, float(1.0), noiseVal);

    // Audio Reactivity: Sparkles flare up on High Frequencies (Melody)
    // Base intensity + Audio boost
    const audioBoost = uAudioHigh.mul(3.0).add(1.0);

    // Fresnel Fade: Glitter is often more visible at grazing angles or facing?
    // Let's make it uniform but slightly boosted at edges for "magic dust" feel
    const NdotV = abs(dot(normalNode, viewDir));
    const fresnel = float(1.0).sub(NdotV).pow(2.0).add(0.5); // Always visible but brighter at edge

    return sparkle.mul(intensity).mul(audioBoost).mul(fresnel);
});

// Legacy helper kept for compatibility
export const addRimLight = Fn(([baseColorNode, normalNode]) => {
    // Pass the normalNode if it exists
    return baseColorNode.add(createRimLight(color(0xFFFFFF), float(0.5), float(3.0), normalNode));
});

/**
 * Derives color from note index (0-11) for musical elements.
 * Reduces vertex buffer count by eliminating per-instance color attributes.
 */
export const colorFromNote = Fn(([noteIndex]) => {
    // Simple rainbow color mapping using sine waves
    const angle = noteIndex.div(12.0).mul(6.28318); // 2*PI

    const r = sin(angle).mul(0.5).add(0.5);
    const g = sin(angle.add(2.0944)).mul(0.5).add(0.5); // 120 degrees
    const b = sin(angle.add(4.1888)).mul(0.5).add(0.5); // 240 degrees

    return vec3(r, g, b);
});

// --- PALETTE HELPER: Player Interaction ---
// Calculates displacement vector based on player proximity
export const calculatePlayerPush = Fn(([currentPos]) => {
    const playerDistVector = positionWorld.sub(uPlayerPosition);
    // We only care about X/Z distance for most vertical foliage (cylinder interaction)
    const playerDistH = vec3(playerDistVector.x, float(0.0), playerDistVector.z);
    const distSq = dot(playerDistH, playerDistH);

    // Interaction Radius = 2.0 (Sq = 4.0)
    const interactRadiusSq = float(4.0);

    // Force falls off with distance
    const pushStrength = smoothstep(interactRadiusSq, float(0.0), distSq);

    // Direction to push (away from player)
    const pushDir = normalize(playerDistH);

    // Bend amount based on height (more bend at top)
    // Use positionLocal.y as a proxy for height from pivot (assuming pivot at bottom)
    const heightFactor = positionLocal.y.max(0.0);
    const bendAmount = pushStrength.mul(1.5).mul(heightFactor);

    // Return offset vector
    return vec3(pushDir.x.mul(bendAmount), float(0.0), pushDir.z.mul(bendAmount));
});

export const applyPlayerInteraction = (basePosNode: any) => {
    // basePosNode should be current position (could be mutated by other effects)
    // We pass it to TSL function if needed, or just add
    return basePosNode.add(calculatePlayerPush(basePosNode));
};

// --- WIND & BLOOM FUNCTIONS ---

/**
 * Optimized wind sway using baked texture sampling
 * Samples wind vector from texture based on world position + time
 */
export const calculateWindSway = Fn(([posNode]) => {
    // Get wind texture data for TSL sampling inside the function to avoid execution order issues
    const windTextureData = getWindTextureData();

    // Create UV coordinates from world position with tiling
    // Scale matches the world-space tiling of the wind texture
    const worldScale = float(0.1); // Matches getWindTextureData().sampleScale
    const timeOffset = uTime.mul(0.1); // Animated wind flow
    
    // UV coordinates: world XZ mapped to texture with animation
    const windUV = vec2(
        positionWorld.x.mul(worldScale).add(timeOffset),
        positionWorld.z.mul(worldScale).add(timeOffset.mul(0.5)) // Different speed for Y axis
    );
    
    // Sample wind vector from baked texture (RG channels = XZ wind)
    const windSample = texture(windTextureData.texture, windUV);
    const windX = windSample.r;
    const windZ = windSample.g;
    const gustIntensity = windSample.b; // Gust intensity for variation
    
    // Height factor: more sway at the top (cantilever effect)
    const heightFactor = posNode.y.max(0.0);
    const heightBend = heightFactor.pow(2.0); // Squared for natural bend curve
    
    // Apply global wind speed uniform for dynamic control
    const speedMultiplier = uWindSpeed.add(0.2).mul(0.1);
    
    // Apply gust intensity for dynamic variation
    const gustMultiplier = float(1.0).add(gustIntensity.mul(0.5));
    
    // Calculate final bend offset
    // Uses direction uniform for global wind direction control
    const windBend = vec3(
        windX.mul(uWindDirection.x).mul(heightBend).mul(speedMultiplier).mul(gustMultiplier),
        float(0.0),
        windZ.mul(uWindDirection.z).mul(heightBend).mul(speedMultiplier).mul(gustMultiplier)
    );

    return windBend;
});

/**
 * Legacy wind sway calculation (kept for comparison/debugging)
 * Use this to verify visual quality matches the optimized version
 */
export const calculateWindSwayLegacy = Fn(([posNode]) => {
    const windTime = uTime.mul(uWindSpeed.add(0.5));
    // Continuous phase field for wind
    const swayPhase = positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.5)).add(windTime);
    const swayAmount = sin(swayPhase).mul(0.1).mul(uWindSpeed.add(0.2));

    // Cantilever bend: Bending increases with height squared
    // Assumes pivot at bottom (y=0)
    const heightFactor = posNode.y.max(0.0);

    const windBend = vec3(
        uWindDirection.x.mul(swayAmount).mul(heightFactor.pow(2.0)),
        float(0.0),
        uWindDirection.z.mul(swayAmount).mul(heightFactor.pow(2.0))
    );

    return windBend;
});

// Re-export wind compute system for external access
export { getWindTextureData, windComputeSystem } from './wind-compute.ts';

export const calculateFlowerBloom = (posNode?: any) => {
    // DO NOT USE Fn()!
    // As per the guidance: "No Scope Loss: By removing Fn(), you are just chaining JS objects (TSL Nodes) together synchronously."

    // 1. Safely resolve the position node FIRST
    const _pos = posNode || positionLocal;

    // 2. Declare the custom instanced attribute
    const aPoseState = attribute('aPoseState', 'float');

    // 3. Build the math graph directly (no Fn wrapper!)
    const breath = sin(uTime.mul(2.0)).mul(0.05);
    const bloom = uAudioLow.mul(0.3);
    const scale = float(1.0).add(aPoseState).add(breath).add(bloom);

    // 4. Return the multiplied node
    // Let's use `scale.mul(_pos)` since `float().mul()` is always guaranteed to work on nodes.
    return scale.mul(_pos);
};

// --- UNIFIED MATERIAL PIPELINE ---

export interface UnifiedMaterialOptions {
    colorNode?: Node;
    deformationNode?: Node;
    roughness?: number;
    metalness?: number;
    bumpStrength?: number;
    noiseScale?: number;
    triplanar?: boolean;
    side?: THREE.Side;
    transmission?: number;
    thickness?: number;
    ior?: number;
    thicknessDistortion?: number;
    subsurfaceStrength?: number;
    subsurfaceColor?: number | THREE.Color;
    iridescenceStrength?: number;
    iridescenceFresnelPower?: number;
    sheen?: number;
    sheenColor?: number | THREE.Color;
    sheenRoughness?: number;
    animateMoisture?: boolean;
    animatePulse?: boolean;
    audioReactStrength?: number;
    emissive?: number | string | THREE.Color;
    emissiveIntensity?: number;

    // Rim Light (Juicy Edge)
    rimStrength?: number;
    rimColor?: number | string | THREE.Color;
    rimPower?: number;
}

/**
 * Creates a highly configurable procedural material using TSL.
 * Supports: Micro-bumps, Transmission, SSS, Iridescence, Sheen, and Animation.
 */
export function createUnifiedMaterial(hexColor: number | string | THREE.Color, options: UnifiedMaterialOptions = {}) {
    const {
        // Material Overrides
        colorNode = null,
        deformationNode = null,

        // Surface Basics
        roughness = 0.5,
        metalness = 0.0,
        bumpStrength = 0.0,
        noiseScale = 5.0,
        triplanar = false,      // Use triplanar mapping for bumps?
        side = THREE.FrontSide, // Render side

        // Emissive
        emissive = null,
        emissiveIntensity = 1.0,

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
        animatePulse = false,

        // Audio Reactivity (Juice)
        audioReactStrength = 0.0,

        // Rim Light (Palette Polish)
        rimStrength = 0.0,
        rimColor = 0xFFFFFF,
        rimPower = 3.0
    } = options;

    const material = new MeshStandardNodeMaterial();

    // 1. Base Properties
    if (colorNode) {
        material.colorNode = colorNode;
    } else {
        material.colorNode = color(hexColor);
    }
    material.roughnessNode = float(roughness);
    material.metalnessNode = float(metalness);
    material.side = side;

    if (emissive !== null) {
        material.emissiveNode = color(emissive).mul(float(emissiveIntensity));
    }

    // 2. Procedural Surface Noise (Micro-geometry)
    let surfaceNoise: any = float(0.0);

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

    // 8. Global Glitch Effect (Sample Offset / Pixelation) + Local Glitch Grenade
    const basePos = deformationNode || material.positionNode || positionLocal;

    // Calculate local glitch intensity based on distance
    const distToGlitch = positionWorld.distance(uGlitchExplosionCenter);
    // Smooth falloff: 1.0 at center, 0.0 at edge
    const localGlitchFactor = float(1.0).sub(smoothstep(float(0.0), uGlitchExplosionRadius, distToGlitch));
    // Apply local glitch only when radius > 0
    const isActive = uGlitchExplosionRadius.greaterThan(0.0);
    // If active, combine local with global intensity. (Mix or Add)
    // localGlitchFactor will be 0 if dist > radius.
    // Use select to apply local only when radius > 0, otherwise just global
    const localIntensity = localGlitchFactor.mul(float(1.5)); // Base intensity of grenade
    const combinedIntensity = uGlitchIntensity.add(isActive.select(localIntensity, float(0.0)));

    const glitchRes = applyGlitch(uv(), basePos, combinedIntensity);

    // Override position with glitched version
    material.positionNode = glitchRes.position;

    // 9. Audio Reactivity (Juice) - "Singing Materials"
    if (audioReactStrength > 0.0) {
        // A. Visual "Singing" (Emissive Pulse)
        // We use High Frequency (Melody) for flowers/delicate objects
        const singPulse = uAudioHigh.mul(audioReactStrength);

        // Pulse the base color into the emissive channel
        // Factor 0.5 ensures it's a glow, not a blinding flash
        const singGlow = material.colorNode.mul(singPulse).mul(0.5);
        material.emissiveNode = (material.emissiveNode || color(0x000000)).add(singGlow);

        // B. Physical "Vibration" (Vertex Flutter)
        // Add subtle noise displacement to simulate sound waves vibrating the surface
        // Ensure we have a starting position node
        const currentPos = material.positionNode || positionLocal;

        // High frequency noise based on position and fast time
        const vibrationScale = float(20.0);
        const vibrationSpeed = float(10.0);
        const flutterNoise = mx_noise_float(positionLocal.mul(vibrationScale).add(uTime.mul(vibrationSpeed)));

        // Amplitude: Small (0.02) scaled by audio volume
        const flutterAmp = singPulse.mul(0.02);

        // Displace along local normal
        // Use normalLocal if available in scope, otherwise recalculate or use normalWorld (less accurate for local vibration)
        const vibration = normalLocal.mul(flutterNoise).mul(flutterAmp);

        material.positionNode = currentPos.add(vibration);
    }

    // 10. Rim Light (Palette Polish)
    // Adds a subtle edge glow to define the shape against dark backgrounds
    if (rimStrength > 0.0) {
        const rimColorNode = color(rimColor);
        // Use current material normal (might be perturbed by bumps)
        const rimEffect = createRimLight(rimColorNode, float(rimStrength), float(rimPower), material.normalNode);

        // Add to existing emissive
        material.emissiveNode = (material.emissiveNode || color(0x000000)).add(rimEffect);
    }

    material.userData.isUnified = true;
    return material;
}

// --- PRESETS (The "Beauty" Collection) ---

type PresetFn = (hex: number | string | THREE.Color, opts?: UnifiedMaterialOptions) => MeshStandardNodeMaterial;

export const CandyPresets: { [key: string]: PresetFn } = {
    // 1. Standard Clay: Tactile, slightly bumpy, matte
    Clay: (hex, opts={}) => createUnifiedMaterial(hex, {
        roughness: 0.8,
        bumpStrength: 0.15,
        noiseScale: 8.0,
        triplanar: true,
        // PALETTE: Subtle Rim Light by default
        rimStrength: 0.3,
        rimPower: 3.0,
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

export function createClayMaterial(hexColor: number | string | THREE.Color, opts: UnifiedMaterialOptions={}) {
    return CandyPresets.Clay(hexColor, opts);
}

export function createCandyMaterial(hexColor: number | string | THREE.Color, opts: UnifiedMaterialOptions={}) {
    return CandyPresets.Gummy(hexColor, opts); // Upgrade old candy to Gummy
}

export function createTexturedClay(hexColor: number | string | THREE.Color, options: any={}) {
    return createUnifiedMaterial(hexColor, {
        roughness: options.roughness || 0.6,
        bumpStrength: options.bumpStrength || 0.1,
        noiseScale: options.noiseScale || 5.0,
        triplanar: true
    });
}

export function createSugaredMaterial(hexColor: number | string | THREE.Color, options: any={}) {
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

// Juicy Bark Material (Replaces Legacy Gradient)
export function createGradientMaterial(colorBottom: number | string | THREE.Color, colorTop: number | string | THREE.Color, roughness = 0.9) {
    // 1. TSL Sway + Interaction Logic
    const windTime = uTime.mul(uWindSpeed.add(0.5));
    // Continuous phase field for wind
    const swayPhase = positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.5)).add(windTime);
    const swayAmount = sin(swayPhase).mul(0.1).mul(uWindSpeed.add(0.2));

    // Height factor (0 at bottom, 1 at top for unit cylinder translated up)
    const heightFactor = positionLocal.y.max(0.0);

    // Cantilever bend: Bending increases with height squared
    const windBend = vec3(
        uWindDirection.x.mul(swayAmount).mul(heightFactor.pow(2.0)),
        float(0.0),
        uWindDirection.z.mul(swayAmount).mul(heightFactor.pow(2.0))
    );

    // Player Push: Bends away from player
    const pushOffset = calculatePlayerPush(positionLocal);

    // Total Vertex Deformation
    const totalDeformation = positionLocal.add(windBend).add(pushOffset);

    // 2. Gradient Color
    const gradientNode = mix(color(colorBottom), color(colorTop), uv().y);

    // 3. Create Unified Material with Bark presets
    return createUnifiedMaterial(colorBottom, {
        colorNode: gradientNode,
        deformationNode: totalDeformation,
        roughness: roughness,
        bumpStrength: 0.2,   // Bark texture
        noiseScale: 4.0,     // Scale of bark details
        triplanar: true,     // Avoid UV seams on cylinder
        metalness: 0.0,
        // PALETTE: Subtle Rim Light for trunks too
        rimStrength: 0.3,
        rimPower: 3.0
    });
}

// Helper to create a MeshStandardNodeMaterial behaving like MeshStandardMaterial
export function createStandardNodeMaterial(options: any = {}) {
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

export function createTransparentNodeMaterial(options: any = {}) {
    const mat = createStandardNodeMaterial(options);
    mat.transparent = true;
    mat.depthWrite = options.depthWrite !== undefined ? options.depthWrite : false; 
    return mat;
}
