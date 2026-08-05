import * as THREE from 'three';

export interface PaletteEntry {
    skyTop: THREE.Color;
    skyBot: THREE.Color;
    horizon: THREE.Color;
    fog: THREE.Color;
    sun: THREE.Color;
    amb: THREE.Color;
    sunInt: number;
    ambInt: number;
    atmosphereIntensity: number;
}

/** Uniform scale range for a procedural entity archetype. */
export interface EntityScaleRange {
    base: number;
    min: number;
    max: number;
}

/**
 * Canonical procedural scale entry. `refHeight` documents world-unit proportions at
 * `base` scale (tree trunk ≈ 4–6u, mushroom cap ≈ 1–2u, gem fruit ≈ 0.25u).
 * Types that pass `height` / `size` instead of `scale` may supply `height`.
 */
export interface EntityScaleEntry extends EntityScaleRange {
    refHeight?: number;
    height?: EntityScaleRange;
    biomeOverrides?: Record<string, Partial<EntityScaleEntry>>;
}

export const PALETTE: Record<string, PaletteEntry> = {
    // Standard Season (Spring/Default)
    day: {
        skyTop: new THREE.Color(0x87ceeb), // Brighter sky blue for day
        skyBot: new THREE.Color(0xb8e6f0), // Softer transition to horizon
        horizon: new THREE.Color(0xffe5cc), // Warm peachy horizon glow
        fog: new THREE.Color(0xffc5d3), // Warmer pastel pink fog
        sun: new THREE.Color(0xfffaf0), // Warm white sunlight
        amb: new THREE.Color(0xfff5ee), // Soft seashell ambient
        sunInt: 0.9,
        ambInt: 0.65,
        atmosphereIntensity: 0.3,
    },
    // Pattern 1: Neon Synthwave (D01-D20 range)
    neon: {
        skyTop: new THREE.Color(0x220044), // Deep purple
        skyBot: new THREE.Color(0xff00ff), // Neon magenta
        horizon: new THREE.Color(0x00ffff), // Cyan horizon
        fog: new THREE.Color(0x5500aa), // Purple fog
        sun: new THREE.Color(0xff00aa), // Pink sun
        amb: new THREE.Color(0x440088), // Purple ambient
        sunInt: 0.8,
        ambInt: 0.7,
        atmosphereIntensity: 0.9,
    },
    // Pattern 2: Glitch/Monochrome (D21+ range)
    glitch: {
        skyTop: new THREE.Color(0x000000), // Black
        skyBot: new THREE.Color(0x888888), // Grey
        horizon: new THREE.Color(0xffffff), // White
        fog: new THREE.Color(0xaaaaaa), // Grey fog
        sun: new THREE.Color(0xffffff), // White sun
        amb: new THREE.Color(0x444444), // Grey ambient
        sunInt: 1.0,
        ambInt: 0.5,
        atmosphereIntensity: 0.0,
    },
    sunset: {
        skyTop: new THREE.Color(0x4b3d8f), // Rich purple-blue
        skyBot: new THREE.Color(0xff6b4a), // Warm coral-orange glow
        horizon: new THREE.Color(0xffb347), // Vibrant orange-gold horizon
        fog: new THREE.Color(0xe87b9f), // Candy pink-coral fog
        sun: new THREE.Color(0xffa040), // Golden-orange sun
        amb: new THREE.Color(0x9b5050), // Warm reddish ambient
        sunInt: 0.55,
        ambInt: 0.45,
        atmosphereIntensity: 0.7, // Strong atmospheric effect at sunset
    },
    night: {
        skyTop: new THREE.Color(0x0a0a2e), // Deeper night blue with slight color
        skyBot: new THREE.Color(0x1a1a35), // Slightly lighter horizon at night
        horizon: new THREE.Color(0x2a2a4a), // Subtle purple-blue horizon glow
        fog: new THREE.Color(0x0a0a18), // Dark blue-tinted fog
        sun: new THREE.Color(0x334466), // Moonlight blue tint
        amb: new THREE.Color(0x080815), // Very dim ambient
        sunInt: 0.12,
        ambInt: 0.08,
        atmosphereIntensity: 0.15, // Subtle night atmosphere
    },
    sunrise: {
        skyTop: new THREE.Color(0x48d8e8), // Bright turquoise dawn sky
        skyBot: new THREE.Color(0xff9bac), // Warm rosy pink
        horizon: new THREE.Color(0xffd4a3), // Golden peachy horizon
        fog: new THREE.Color(0xffe4ca), // Peachy-warm fog
        sun: new THREE.Color(0xffe066), // Golden morning light
        amb: new THREE.Color(0xffc8d8), // Soft pink ambient
        sunInt: 0.65,
        ambInt: 0.55,
        atmosphereIntensity: 0.6, // Strong morning atmosphere
    },
};
