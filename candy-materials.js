import * as THREE from 'three';
import { color, vec3, vec4, float, positionWorld, normalWorld, normalView, positionView, cameraPosition, dot, pow, mix, smoothstep, sin, cos, time, uv, uniform } from 'three/tsl';
import { MeshStandardNodeMaterial, MeshPhysicalNodeMaterial } from 'three/webgpu';

// Helper to create lighter materials for performance
const LOW_QUALITY = false; // Toggle this if still slow

export function createCandyMaterial(options = {}) {
    const {
        baseColor = 0xFF69B4,
        roughness = 0.3,
        translucency = 0.5,
        iridescence = 0.0,
        emissive = 0x000000,
        emissiveIntensity = 0.0
    } = options;

    // Use Standard instead of Physical where possible to save transmission passes
    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        roughness: roughness,
        metalness: 0.0,
        emissive: emissive,
        emissiveIntensity: emissiveIntensity
    });

    // TSL: Cheap Fake Subsurface Scattering (Rim Lighting)
    // This is much cheaper than real transmission/SSS
    const normal = normalView;
    const viewDir = positionView.negate().normalize();
    const rimDot = dot(normal, viewDir).abs().oneMinus();
    const rim = pow(rimDot, float(3.0)).mul(translucency);

    const rimColor = color(baseColor).mul(rim).mul(2.0);

    // Add iridescent shift cheaply
    if (iridescence > 0) {
        const shift = rimDot.mul(6.28);
        const r = sin(shift).mul(0.5).add(0.5);
        const g = sin(shift.add(2.0)).mul(0.5).add(0.5);
        const b = sin(shift.add(4.0)).mul(0.5).add(0.5);
        material.colorNode = mix(color(baseColor), vec3(r,g,b), float(iridescence).mul(rim));
    }

    material.emissiveNode = rimColor.add(color(emissive).mul(emissiveIntensity));

    return material;
}

// ... (Other materials simplified similarly) ...

export function createGlowingCandyMaterial(options = {}) {
    const { baseColor = 0xFFD700, glowIntensity = 1.5, pulseSpeed = 2.0 } = options;
    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        emissive: baseColor,
        roughness: 0.4
    });
    const pulse = time.mul(pulseSpeed).sin().mul(0.3).add(0.7);
    material.emissiveIntensityNode = float(glowIntensity).mul(pulse);
    return material;
}

export function createPetalMaterial(options = {}) {
    // Petals don't need refraction, just transparency
    const { baseColor = 0xFFB7C5, translucency = 0.8 } = options;
    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        roughness: 0.5,
        transparent: true,
        opacity: 0.9, // Alpha blend is cheaper than transmission
        side: THREE.DoubleSide
    });

    // Simple backlight
    const normal = normalView;
    const viewDir = positionView.negate().normalize();
    const rim = dot(normal, viewDir).abs().oneMinus();
    material.emissiveNode = color(baseColor).mul(rim).mul(translucency);

    return material;
}

export function createIridescentMaterial(options = {}) {
    return createCandyMaterial({...options, iridescence: 0.8});
}
export function createJellyMaterial(options = {}) {
    return createCandyMaterial({...options, translucency: 0.9});
}
export function createFrostedMaterial(options = {}) {
    return createCandyMaterial({...options, roughness: 0.9});
}
export function createSwirledMaterial(options = {}) {
    return createCandyMaterial(options);
}

export const uAudioPulse = uniform(0.0);
export const uAudioColor = uniform(color(0xFFFFFF));

export function createAudioReactiveMaterial(options = {}) {
    const { baseColor = 0xFF6347 } = options;
    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        emissive: baseColor
    });
    material.emissiveIntensityNode = uAudioPulse.mul(2.0);
    return material;
}

export function createGroundMaterial(options = {}) {
    const { baseColor = 0x98FB98 } = options;
    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        roughness: 0.9
    });
    // Keep it simple
    return material;
}

export function updateAudioReactiveMaterials(audioState) {
    if (audioState.kick !== undefined) uAudioPulse.value = audioState.kick;
    if (audioState.color) uAudioColor.value.setHex(audioState.color);
}
