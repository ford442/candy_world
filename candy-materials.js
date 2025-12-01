// filepath: g:\github\candy_world\candy-materials.js
import * as THREE from 'three';
import { color, vec3, vec4, float, positionWorld, normalWorld, normalView, viewPosition, dot, pow, mix, smoothstep, sin, cos, time, uv, uniform } from 'three/tsl';
import { MeshStandardNodeMaterial, MeshPhysicalNodeMaterial } from 'three/webgpu';

/**
 * Advanced Candy/Claymorphic Materials with Subsurface Scattering
 * Provides soft, translucent, iridescent effects for candy world aesthetic
 */

// --- Enhanced Candy Material with Subsurface Scattering ---
export function createCandyMaterial(options = {}) {
    const {
        baseColor = 0xFF69B4,
        roughness = 0.3,
        metalness = 0.0,
        translucency = 0.5,
        iridescence = 0.0,
        emissive = 0x000000,
        emissiveIntensity = 0.0
    } = options;

    const material = new MeshPhysicalNodeMaterial({
        color: baseColor,
        roughness: roughness,
        metalness: metalness,
        clearcoat: 0.3,
        clearcoatRoughness: 0.2,
        transmission: 0.0,
        thickness: 0.5,
        emissive: emissive,
        emissiveIntensity: emissiveIntensity
    });

    // TSL: Fake Subsurface Scattering (Rim Lighting)
    const normal = normalView;
    const viewDir = viewPosition.normalize();
    const rimDot = dot(normal, viewDir).abs().oneMinus();
    const rimPower = float(3.0);
    const rim = pow(rimDot, rimPower).mul(translucency);

    // Add rim light to emissive for soft glow
    const rimColor = color(baseColor).mul(rim).mul(2.0);
    material.emissiveNode = rimColor.add(color(emissive).mul(emissiveIntensity));

    // Iridescent color shift based on view angle
    if (iridescence > 0) {
        const iridescenceShift = rimDot.mul(Math.PI * 2.0);
        const iridR = sin(iridescenceShift).mul(0.5).add(0.5);
        const iridG = sin(iridescenceShift.add(Math.PI * 0.66)).mul(0.5).add(0.5);
        const iridB = sin(iridescenceShift.add(Math.PI * 1.33)).mul(0.5).add(0.5);
        const iridColor = vec3(iridR, iridG, iridB);

        material.colorNode = mix(
            color(baseColor),
            iridColor,
            float(iridescence).mul(rim)
        );
    }

    return material;
}

// --- Glowing Candy Material ---
export function createGlowingCandyMaterial(options = {}) {
    const {
        baseColor = 0xFFD700,
        glowIntensity = 1.5,
        pulseSpeed = 2.0,
        roughness = 0.4
    } = options;

    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        emissive: baseColor,
        roughness: roughness,
        metalness: 0.0
    });

    // TSL: Pulsing glow
    const pulse = time.mul(pulseSpeed).sin().mul(0.3).add(0.7);
    material.emissiveIntensityNode = float(glowIntensity).mul(pulse);

    // Add rim glow
    const normal = normalView;
    const viewDir = viewPosition.normalize();
    const rimDot = dot(normal, viewDir).abs().oneMinus();
    const rim = pow(rimDot, float(2.0)).mul(0.5);

    const finalEmissive = color(baseColor).mul(pulse.mul(glowIntensity).add(rim));
    material.emissiveNode = finalEmissive;

    return material;
}

// --- Translucent Petal Material ---
export function createPetalMaterial(options = {}) {
    const {
        baseColor = 0xFFB7C5,
        translucency = 0.8,
        veins = true
    } = options;

    const material = new MeshPhysicalNodeMaterial({
        color: baseColor,
        roughness: 0.5,
        metalness: 0.0,
        transmission: 0.3,
        thickness: 0.2,
        clearcoat: 0.1
    });

    // TSL: Subsurface scattering effect
    const normal = normalWorld;
    const viewDir = positionWorld.sub(viewPosition).normalize();
    const NdotV = dot(normal, viewDir).abs();

    // Back-lighting effect (fake translucency)
    const backlight = NdotV.oneMinus().mul(translucency);
    const backlightColor = color(baseColor).mul(backlight).mul(2.0);

    material.emissiveNode = backlightColor;

    // Optional: Add vein pattern
    if (veins) {
        const uvCoord = uv();
        const veinPattern = sin(uvCoord.x.mul(20.0)).mul(sin(uvCoord.y.mul(20.0)));
        const veinMask = smoothstep(float(0.4), float(0.6), veinPattern);

        // Darken along veins
        const veinedColor = mix(
            color(baseColor).mul(0.7),
            color(baseColor),
            veinMask
        );
        material.colorNode = veinedColor;
    }

    return material;
}

// --- Iridescent Material (Bubble-like) ---
export function createIridescentMaterial(options = {}) {
    const {
        baseColor = 0xFFFFFF,
        strength = 0.8,
        roughness = 0.1
    } = options;

    const material = new MeshPhysicalNodeMaterial({
        roughness: roughness,
        metalness: 0.1,
        transmission: 0.5,
        thickness: 0.5,
        clearcoat: 1.0,
        clearcoatRoughness: 0.0
    });

    // TSL: Rainbow iridescence
    const normal = normalView;
    const viewDir = viewPosition.normalize();
    const fresnel = dot(normal, viewDir).abs().oneMinus();

    // Create rainbow effect
    const hueShift = fresnel.mul(Math.PI * 2.0);
    const r = sin(hueShift).mul(0.5).add(0.5);
    const g = sin(hueShift.add(Math.PI * 0.66)).mul(0.5).add(0.5);
    const b = sin(hueShift.add(Math.PI * 1.33)).mul(0.5).add(0.5);
    const rainbow = vec3(r, g, b);

    material.colorNode = mix(
        color(baseColor),
        rainbow,
        float(strength).mul(fresnel)
    );

    return material;
}

// --- Jelly/Gel Material ---
export function createJellyMaterial(options = {}) {
    const {
        baseColor = 0x87CEEB,
        opacity = 0.8,
        wobble = true
    } = options;

    const material = new MeshPhysicalNodeMaterial({
        color: baseColor,
        roughness: 0.1,
        metalness: 0.0,
        transmission: 0.7,
        thickness: 1.0,
        transparent: true,
        opacity: opacity,
        clearcoat: 0.5,
        ior: 1.4
    });

    // TSL: Wobbly distortion effect
    if (wobble) {
        const pos = positionWorld;
        const wobbleEffect = sin(time.mul(2.0).add(pos.x.mul(5.0))).mul(0.02);
        const wobbleNormal = normalWorld.add(vec3(wobbleEffect, wobbleEffect.mul(0.5), wobbleEffect));

        // This would normally affect refraction, but we can fake it with emissive
        const wobbleHighlight = wobbleEffect.abs().mul(0.3);
        material.emissiveNode = color(baseColor).mul(wobbleHighlight);
    }

    return material;
}

// --- Frosted Candy Material ---
export function createFrostedMaterial(options = {}) {
    const {
        baseColor = 0xE6E6FA,
        roughness = 0.6,
        sparkle = true
    } = options;

    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        roughness: roughness,
        metalness: 0.0
    });

    // TSL: Frost sparkles
    if (sparkle) {
        const pos = positionWorld;
        const noise = sin(pos.x.mul(50.0)).mul(sin(pos.y.mul(50.0))).mul(sin(pos.z.mul(50.0)));
        const sparkles = smoothstep(float(0.8), float(0.9), noise);

        material.emissiveNode = color(0xFFFFFF).mul(sparkles).mul(0.5);
    }

    // Add subtle rim light
    const normal = normalView;
    const viewDir = viewPosition.normalize();
    const rim = dot(normal, viewDir).abs().oneMinus();
    const rimLight = pow(rim, float(4.0)).mul(0.3);

    const currentEmissive = material.emissiveNode || color(0x000000);
    material.emissiveNode = currentEmissive.add(color(baseColor).mul(rimLight));

    return material;
}

// --- Swirled Candy Material ---
export function createSwirledMaterial(options = {}) {
    const {
        color1 = 0xFF69B4,
        color2 = 0xFFFFFF,
        scale = 5.0,
        roughness = 0.3
    } = options;

    const material = new MeshStandardNodeMaterial({
        roughness: roughness,
        metalness: 0.0
    });

    // TSL: Swirl pattern
    const pos = positionWorld;
    const swirl = sin(pos.x.mul(scale).add(pos.z.mul(scale))).mul(0.5).add(0.5);
    const twist = sin(pos.y.mul(scale * 2.0));
    const pattern = swirl.add(twist.mul(0.3));

    const swirlPattern = smoothstep(float(0.4), float(0.6), pattern);

    material.colorNode = mix(
        color(color1),
        color(color2),
        swirlPattern
    );

    return material;
}

// --- Audio-Reactive Material ---
export const uAudioPulse = uniform(0.0);
export const uAudioColor = uniform(color(0xFFFFFF));

export function createAudioReactiveMaterial(options = {}) {
    const {
        baseColor = 0xFF6347,
        intensity = 2.0,
        roughness = 0.4
    } = options;

    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        emissive: baseColor,
        roughness: roughness,
        metalness: 0.0
    });

    // TSL: React to audio
    const pulseEffect = uAudioPulse.mul(intensity);

    material.emissiveIntensityNode = pulseEffect;
    material.emissiveNode = mix(
        color(baseColor),
        uAudioColor,
        uAudioPulse.mul(0.8)
    );

    // Add expansion effect to color
    const expandedColor = mix(
        color(baseColor),
        color(baseColor).mul(1.5),
        pulseEffect
    );
    material.colorNode = expandedColor;

    return material;
}

// --- Ground Material with Procedural Detail ---
export function createGroundMaterial(options = {}) {
    const {
        baseColor = 0x98FB98,
        detailScale = 10.0,
        roughness = 0.9
    } = options;

    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        roughness: roughness,
        metalness: 0.0
    });

    // TSL: Procedural ground detail
    const pos = positionWorld;

    // Multi-octave noise-like pattern
    const detail1 = sin(pos.x.mul(detailScale)).mul(sin(pos.z.mul(detailScale)));
    const detail2 = sin(pos.x.mul(detailScale * 2.3)).mul(sin(pos.z.mul(detailScale * 2.3)));
    const detail3 = sin(pos.x.mul(detailScale * 5.7)).mul(sin(pos.z.mul(detailScale * 5.7)));

    const combined = detail1.mul(0.5).add(detail2.mul(0.3)).add(detail3.mul(0.2));
    const pattern = combined.mul(0.5).add(0.5);

    // Color variation
    const groundColor = mix(
        color(baseColor).mul(0.8),
        color(baseColor).mul(1.2),
        smoothstep(float(0.3), float(0.7), pattern)
    );

    material.colorNode = groundColor;

    // Fake bump effect by adjusting emissive slightly
    const bump = pattern.sub(0.5).mul(0.1);
    material.emissiveNode = color(baseColor).mul(bump.max(0.0));

    return material;
}

// Helper: Update audio-reactive materials
export function updateAudioReactiveMaterials(audioState) {
    if (audioState.kick !== undefined) {
        uAudioPulse.value = audioState.kick;
    }

    if (audioState.color) {
        uAudioColor.value.setHex(audioState.color);
    }
}

export {
    createCandyMaterial,
    createGlowingCandyMaterial,
    createPetalMaterial,
    createIridescentMaterial,
    createJellyMaterial,
    createFrostedMaterial,
    createSwirledMaterial,
    createAudioReactiveMaterial,
    createGroundMaterial,
    updateAudioReactiveMaterials
};

