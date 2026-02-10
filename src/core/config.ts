import * as THREE from 'three';

// Cycle: Sunrise (1m), Day (7m), Sunset (1m), Night (7m) = Total 16m = 960s
export const DURATION_SUNRISE = 60;
export const DURATION_DAY = 420;
export const DURATION_SUNSET = 60;
export const DURATION_DUSK_NIGHT = 180; // 3 min
export const DURATION_DEEP_NIGHT = 120; // 2 min
export const DURATION_PRE_DAWN = 120;   // 2 min
export const CYCLE_DURATION = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET + DURATION_DUSK_NIGHT + DURATION_DEEP_NIGHT + DURATION_PRE_DAWN; // 960s

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

export const PALETTE: Record<string, PaletteEntry> = {
    // Standard Season (Spring/Default)
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
    // Pattern 1: Neon Synthwave (D01-D20 range)
    neon: {
        skyTop: new THREE.Color(0x220044),   // Deep purple
        skyBot: new THREE.Color(0xFF00FF),   // Neon magenta
        horizon: new THREE.Color(0x00FFFF),  // Cyan horizon
        fog: new THREE.Color(0x5500AA),      // Purple fog
        sun: new THREE.Color(0xFF00AA),      // Pink sun
        amb: new THREE.Color(0x440088),      // Purple ambient
        sunInt: 0.8,
        ambInt: 0.7,
        atmosphereIntensity: 0.9
    },
    // Pattern 2: Glitch/Monochrome (D21+ range)
    glitch: {
        skyTop: new THREE.Color(0x000000),   // Black
        skyBot: new THREE.Color(0x888888),   // Grey
        horizon: new THREE.Color(0xFFFFFF),  // White
        fog: new THREE.Color(0xAAAAAA),      // Grey fog
        sun: new THREE.Color(0xFFFFFF),      // White sun
        amb: new THREE.Color(0x444444),      // Grey ambient
        sunInt: 1.0,
        ambInt: 0.5,
        atmosphereIntensity: 0.0
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

export interface ConfigType {
    colors: {
        ground: number;
        fog: number;
    };
    interaction: {
        maxDistance: number;
        proximityRadius: number;
        interactionDistance: number;
    };
    glow: {
        startOffsetMinutes: number;
        endOffsetMinutes: number;
    };
    noteColorMap: {
        global: Record<string, number>;
        mushroom: Record<string, number>;
        flower: Record<string, number>;
        tree: Record<string, number>;
        cloud: Record<string, number>;
        [key: string]: Record<string, number>; // Allow for dynamic access if needed
    };
    reactivity: {
        [key: string]: {
            medianWindow?: number;
            smoothingRate?: number;
            scale?: number;
            maxAmplitude?: number;
            minThreshold?: number;
        };
    };
    flashScale: number;
    debugNoteReactivity: boolean;
    moon: {
        blinkDuration: number;
        blinkInterval: number;
        danceAmplitude: number;
        danceFrequency: number;
    };
    audio: {
        useScriptProcessorNode: boolean;
    };
}

export const CONFIG: ConfigType = {
    colors: {
        ground: 0x222222,
        fog: 0x1A1A2E
    },

    // --- NEW INTERACTION SETTINGS ---
    interaction: {
        maxDistance: 60,         // Raycast max range
        proximityRadius: 12.0,   // Object "wakes up"
        interactionDistance: 8.0 // Object becomes clickable
    },

    // --- TWILIGHT GLOW SETTINGS ---
    glow: {
        startOffsetMinutes: 30, // Start glowing 30 min before sunset
        endOffsetMinutes: 30,   // Stop glowing 30 min after sunrise (or before? usually before dawn, but let's stick to plan)
        // Plan says "stop before dawn". Let's say it fades out during pre-dawn.
    },

    // --- NOTE COLOR MAPPING ---
    noteColorMap: {
        // Standard Global Palette (Fallback)
        'global': {
            'C': 0xFF0000, 'C#': 0xFF7F00, 'D': 0xFFFF00, 'D#': 0x7FFF00,
            'E': 0x00FF00, 'F': 0x00FF7F, 'F#': 0x00FFFF, 'G': 0x007FFF,
            'G#': 0x0000FF, 'A': 0x7F00FF, 'A#': 0xFF00FF, 'B': 0xFF007F
        },
        // Species: Mushroom (Shader-matched palette)
        'mushroom': {
            'C':  0xFF4040, // Red
            'C#': 0xEF1280, // Magenta-Red
            'D':  0xC020C0, // Magenta
            'D#': 0x8020EF, // Violet
            'E':  0x4040FF, // Blue (Peak)
            'F':  0x1280EF, // Azure
            'F#': 0x00C0C0, // Cyan
            'G':  0x12EF80, // Spring Green
            'G#': 0x40FF40, // Green (Peak)
            'A':  0x80EF12, // Lime
            'A#': 0xC0C000, // Yellow
            'B':  0xEF8012  // Orange
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
    debugNoteReactivity: false,

    // Moon animation settings
    moon: {
        blinkDuration: 200, // ms
        blinkInterval: 5000, // ms (average)
        danceAmplitude: 0.2,
        danceFrequency: 1.0 // Hz
    },

    // Audio processing settings
    audio: {
        // Use ScriptProcessorNode for compatibility mode (deprecated but more reliable in some cases)
        // Set to true if experiencing AudioWorkletNode performance issues or slow loading
        // Default: false (uses modern AudioWorkletNode)
        // See AUDIO_COMPATIBILITY_MODE.md for more information
        useScriptProcessorNode: false
    }
};
