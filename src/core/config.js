// src/core/config.js

import * as THREE from 'three';

// Cycle: Sunrise (1m), Day (7m), Sunset (1m), Night (7m) = Total 16m = 960s
export const DURATION_SUNRISE = 60;
export const DURATION_DAY = 420;
export const DURATION_SUNSET = 60;
export const DURATION_DUSK_NIGHT = 180; // 3 min
export const DURATION_DEEP_NIGHT = 120; // 2 min
export const DURATION_PRE_DAWN = 120;   // 2 min
export const CYCLE_DURATION = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET + DURATION_DUSK_NIGHT + DURATION_DEEP_NIGHT + DURATION_PRE_DAWN; // 960s

export const PALETTE = {
    day: {
        skyTop: new THREE.Color(0x87CEEB),   // Brighter sky blue for day
        skyBot: new THREE.Color(0xB8E6F0),   // Softer transition to horizon
        horizon: new THREE.Color(0xFFE5CC),  // Warm peachy horizon glow
        fog: new THREE.Color(0xFFC5D3),      // Warmer pastel pink fog
        sun: new THREE.Color(0xFFFAF0),      // Warm white sunlight
        amb: new THREE.Color(0xFFF5EE),      // Soft seashell ambient
        sunInt: 0.9,
        ambInt: 0.65,
        atmosphereIntensity: 0.3
    },
    sunset: {
        skyTop: new THREE.Color(0x4B3D8F),   // Rich purple-blue
        skyBot: new THREE.Color(0xFF6B4A),   // Warm coral-orange glow
        horizon: new THREE.Color(0xFFB347),  // Vibrant orange-gold horizon
        fog: new THREE.Color(0xE87B9F),      // Candy pink-coral fog
        sun: new THREE.Color(0xFFA040),      // Golden-orange sun
        amb: new THREE.Color(0x9B5050),      // Warm reddish ambient
        sunInt: 0.55,
        ambInt: 0.45,
        atmosphereIntensity: 0.7            // Strong atmospheric effect at sunset
    },
    night: {
        skyTop: new THREE.Color(0x0A0A2E),   // Deeper night blue with slight color
        skyBot: new THREE.Color(0x1A1A35),   // Slightly lighter horizon at night
        horizon: new THREE.Color(0x2A2A4A),  // Subtle purple-blue horizon glow
        fog: new THREE.Color(0x0A0A18),      // Dark blue-tinted fog
        sun: new THREE.Color(0x334466),      // Moonlight blue tint
        amb: new THREE.Color(0x080815),      // Very dim ambient
        sunInt: 0.12,
        ambInt: 0.08,
        atmosphereIntensity: 0.15           // Subtle night atmosphere
    },
    sunrise: {
        skyTop: new THREE.Color(0x48D8E8),   // Bright turquoise dawn sky
        skyBot: new THREE.Color(0xFF9BAC),   // Warm rosy pink
        horizon: new THREE.Color(0xFFD4A3),  // Golden peachy horizon
        fog: new THREE.Color(0xFFE4CA),      // Peachy-warm fog
        sun: new THREE.Color(0xFFE066),      // Golden morning light
        amb: new THREE.Color(0xFFC8D8),      // Soft pink ambient
        sunInt: 0.65,
        ambInt: 0.55,
        atmosphereIntensity: 0.6            // Strong morning atmosphere
    }
};

export const CONFIG = {
    colors: { ground: 0x90EE90 },
    noteColorMap: {
        // Standard Global Palette (Fallback)
        'global': {
            'C': 0xFF0000, 'C#': 0xFF7F00, 'D': 0xFFFF00, 'D#': 0x7FFF00,
            'E': 0x00FF00, 'F': 0x00FF7F, 'F#': 0x00FFFF, 'G': 0x007FFF,
            'G#': 0x0000FF, 'A': 0x7F00FF, 'A#': 0xFF00FF, 'B': 0xFF007F
        },
        // Species: Mushroom (Earthy + Neon Accents)
        'mushroom': {
            'C': 0x8B0000, 'C#': 0xA52A2A, 'D': 0xD2691E, 'D#': 0xFF4500,
            'E': 0xFF8C00, 'F': 0xFFA500, 'F#': 0xFFD700, 'G': 0xDAA520,
            'G#': 0xCD853F, 'A': 0x8B4513, 'A#': 0xA0522D, 'B': 0x800000
        },
        // Species: Flower (Vibrant Pastels)
        'flower': {
            'C': 0xFF69B4, 'C#': 0xFF1493, 'D': 0xFFB6C1, 'D#': 0xFFC0CB,
            'E': 0xDDA0DD, 'F': 0xEE82EE, 'F#': 0xDA70D6, 'G': 0xBA55D3,
            'G#': 0x9370DB, 'A': 0x8A2BE2, 'A#': 0x9400D3, 'B': 0x9932CC
        },
        // Species: Tree (Nature + Biolum)
        'tree': {
            'C': 0x006400, 'C#': 0x228B22, 'D': 0x32CD32, 'D#': 0x90EE90,
            'E': 0x98FB98, 'F': 0x00FF00, 'F#': 0xADFF2F, 'G': 0x7FFF00,
            'G#': 0x7CFC00, 'A': 0x6B8E23, 'A#': 0x556B2F, 'B': 0x808000
        },
        // Species: Cloud (Ethereal)
        'cloud': {
            'C': 0xF0F8FF, 'C#': 0xE6E6FA, 'D': 0xB0C4DE, 'D#': 0xADD8E6,
            'E': 0x87CEEB, 'F': 0x87CEFA, 'F#': 0x00BFFF, 'G': 0x1E90FF,
            'G#': 0x6495ED, 'A': 0x4682B4, 'A#': 0x5F9EA0, 'B': 0x2F4F4F
        }
    },
    // Per-species reaction tuning
    reactivity: {
        mushroom: { medianWindow: 5, smoothingRate: 8, scale: 0.6, maxAmplitude: 1.0, minThreshold: 0.02 }
    },
    // Global flash strength scaler
    flashScale: 2.0,
    // Debug flags
    debugNoteReactivity: false
};
