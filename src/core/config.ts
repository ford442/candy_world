import * as THREE from 'three';
import type { PlantPoseConfig } from '../foliage/plant-pose-machine.ts';

// ---------------------------------------------------------------------------
// FEATURE FLAGS
//
// URL query params let you disable heavy subsystems without touching code:
//   ?no_luminous          — skip luminous plant batcher + lake-island plants
//   ?no_musical           — skip musical flora (arpeggio fern, vibrato violet, etc.)
//   ?no_procedural        — skip procedural extras (random filler objects)
//   ?no_batchers          — skip tree / mushroom / flower GPU batch systems
//   ?no_audio_react       — skip beat-sync and music-reactivity hooks
//   ?no_fireflies         — skip firefly particle system
//   ?no_grass             — skip GPU grass instancing
//
// Combine flags to isolate regressions: ?no_luminous&no_musical
// All flags default to ENABLED (absent = feature on).
// ---------------------------------------------------------------------------

function _hasFlag(key: string): boolean {
    try {
        return new URLSearchParams(window.location.search).has(key);
    } catch {
        return false; // non-browser (test) environment — all features on
    }
}

export const FEATURE_FLAGS = {
    luminousPlants:   !_hasFlag('no_luminous'),
    musicalFlora:     !_hasFlag('no_musical'),
    proceduralExtras: !_hasFlag('no_procedural'),
    batchers:         !_hasFlag('no_batchers'),
    audioReactivity:  !_hasFlag('no_audio_react'),
    fireflies:        !_hasFlag('no_fireflies'),
    grass:            !_hasFlag('no_grass'),
} as const;

// Log active overrides once at startup so the console makes the state obvious.
if (typeof window !== 'undefined') {
    const disabled = Object.entries(FEATURE_FLAGS)
        .filter(([, v]) => !v)
        .map(([k]) => k);
    if (disabled.length > 0) {
        console.warn(`[FeatureFlags] Disabled via URL: ${disabled.join(', ')}`);
    }
}

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
    /** True when ?safe=1 is in the URL — disables shader warmup and skips heavy compute init */
    safeMode: boolean;
    terrain: {
        useGpuHeightmap: boolean;
        heightmapResolution: number;
    };
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
        glowPulseFrequency: number;
        glowPulseAmplitude: number;
        glowIntensityMax: number;
        glowColorMap: Record<string, number>;
    };
    luminousPlants: {
        density: number;
        baseGlowIntensity: number;
        peakGlowIntensity: number;
        pulseSpeed: number;
        pulseDepth: number;
        subsurfaceStrength: number;
        glowIntensity: number;
    };
    noteColorMap: {
        global: Record<string, number>;
        mushroom: Record<string, number>;
        flower: Record<string, number>;
        tree: Record<string, number>;
        cloud: Record<string, number>;
        sky: Record<string, number>;
        luminous_plants: Record<string, number>;
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
    weather: {
        musicReactivity: {
            enabled: boolean;
            blendWeight: number; // 0.0 = no music influence, 1.0 = full override
        };
    };
    /**
     * Per-plant-type ADSR envelope configuration for the day/night pose state machine.
     * Values are data-driven so they can be tuned without touching shader code.
     */
    plantPose: {
        arpeggioFern: PlantPoseConfig;
        portamentoPine: PlantPoseConfig;
        flower: PlantPoseConfig;
    };

    circadian: {
        transitionSeconds: number;
        dayPoseOffset: number;
        nightPoseOffset: number;
        nightGlowMultiplier: number;
        biomeOverrides: Record<string, Partial<{
            transitionSeconds: number;
            dayPoseOffset: number;
            nightPoseOffset: number;
            nightGlowMultiplier: number;
        }>>;
    };

    world: {
        population: {
            proceduralExtras: number;
            arpeggioGroveFerns: number;
            arpeggioGroveOuter: number;
            lakeArpeggioFerns: number;
            lakeDandelions: number;
            scale: number;
        };
    };
}

// Runtime detection (runs early)
export const isCIorHeadless = (): boolean => {
    const isFullBoot =
      (window as any).__IS_FULL_BOOT_TEST === true ||
      localStorage.getItem('__IS_FULL_BOOT_TEST') === 'true';

    const checks = {
      __IS_FULL_BOOT_TEST: isFullBoot,
      __IS_CI_TEST: (window as any).__IS_CI_TEST === true,
      __IS_HEADLESS: (window as any).__IS_HEADLESS === true,
      uaHeadless: navigator.userAgent.includes('Headless'),
      uaPlaywright: navigator.userAgent.includes('Playwright'),
      innerWidthZero: window.innerWidth === 0,
      testModeClass: document.documentElement.classList.contains('test-mode'),
      ciParam: new URLSearchParams(window.location.search).get('ci') === 'true',
    };

    const result = Object.values(checks).some(Boolean);

    console.log('[DEBUG] isCIorHeadless →', result ? 'TRUE ✓' : 'FALSE ✗', checks, 'URL=', window.location.href);

    return result;
  };

export const CONFIG: ConfigType = {
    safeMode: typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('safe'),
    terrain: {
        useGpuHeightmap: true, // Default to true as it is the goal
        heightmapResolution: 256
    },
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
        glowPulseFrequency: 1.0,
        glowPulseAmplitude: 0.5,
        glowIntensityMax: 2.0,
        glowColorMap: {
            'mushroom': 0xFFDDDD,
            'tree': 0xAAFFCC,
            'flower': 0xFFCCEE,
            'dandelion': 0xFFFFAA,
            'wisteria': 0xDDAAFF,
            'lotus': 0xFFBBCC,
            'lantern': 0xFFEEAA,
            'portamento': 0xAAEEFF,
            'global': 0xFFFFFF,
            'luminous_plants': 0x66CCFF
        }
    },

    // --- LUMINOUS PLANTS SETTINGS ---
    luminousPlants: {
        density: 150,
        baseGlowIntensity: 1.0,
        peakGlowIntensity: 3.5,
        pulseSpeed: 1.5,
        pulseDepth: 0.3,
        subsurfaceStrength: 0.8,
        glowIntensity: 2.0
    },

    // --- WORLD POPULATION (Full Mode) ---
    // These control how many objects are spawned when the user selects "Full Game".
    // Reducing these numbers (especially proceduralExtras and the Arpeggio Grove counts)
    // is the most effective way to shorten the loading wait / hang in Full mode.
    // CORE mode is unaffected (it uses a minimal hardcoded set).
    //
    // Quick tuning tips:
    //   - Set scale: 0.5 for a dramatically faster Full mode.
    //   - Lower proceduralExtras first (biggest object count).
    //   - Then reduce arpeggioGrove* numbers (expensive reactive batchers + TSL materials).
    world: {
        population: {
            // Scattered procedural objects across the world (mushrooms, flowers, trees, clouds, etc.)
            proceduralExtras: 220,          // Reduced from 400 for faster Full mode loads

            // Main Arpeggio Grove setpiece (near -60,60)
            arpeggioGroveFerns: 7,          // Reduced from 12
            arpeggioGroveOuter: 4,          // Reduced from 8 (geysers + violets)

            // Secondary Arpeggio-style foliage on the lake island
            lakeArpeggioFerns: 3,           // Reduced from 5
            lakeDandelions: 6,              // Reduced from 10

            // Global multiplier for quick experimentation (1.0 = use the numbers above)
            // Set to 0.5 for a very light Full mode, or 1.5 if you have a powerful machine.
            scale: 1.0
        }
    },

    // --- NOTE COLOR MAPPING ---
    noteColorMap: {
        // Standard Global Palette (Fallback) - matching assets/colorcode.json
        'global': {
            'C': 0xFF0000, 'C#': 0xFF7F00, 'D': 0xFFFF00, 'D#': 0x7FFF00,
            'E': 0x00FF00, 'F': 0x00FF7F, 'F#': 0x00FFFF, 'G': 0x007FFF,
            'G#': 0x0000FF, 'A': 0x7F00FF, 'A#': 0xFF00FF, 'B': 0xFF007F
        },
        // Species: Mushroom (Shader-matched palette)
        'mushroom': {
            'C': 0xFF0000, 'C#': 0xFF7F00, 'D': 0xFFFF00, 'D#': 0x7FFF00,
            'E': 0x00FF00, 'F': 0x00FF7F, 'F#': 0x00FFFF, 'G': 0x007FFF,
            'G#': 0x0000FF, 'A': 0x7F00FF, 'A#': 0xFF00FF, 'B': 0xFF007F
        },
        // Species: Flower (Vibrant Pastels)
        'flower': {
            'C': 0xFF0000, 'C#': 0xFF7F00, 'D': 0xFFFF00, 'D#': 0x7FFF00,
            'E': 0x00FF00, 'F': 0x00FF7F, 'F#': 0x00FFFF, 'G': 0x007FFF,
            'G#': 0x0000FF, 'A': 0x7F00FF, 'A#': 0xFF00FF, 'B': 0xFF007F
        },
        // Species: Tree (Nature + Biolum)
        'tree': {
            'C': 0xFF0000, 'C#': 0xFF7F00, 'D': 0xFFFF00, 'D#': 0x7FFF00,
            'E': 0x00FF00, 'F': 0x00FF7F, 'F#': 0x00FFFF, 'G': 0x007FFF,
            'G#': 0x0000FF, 'A': 0x7F00FF, 'A#': 0xFF00FF, 'B': 0xFF007F
        },
        // Species: Cloud (Ethereal)
        'cloud': {
            'C': 0xF0F8FF, 'C#': 0xE6E6FA, 'D': 0xB0C4DE, 'D#': 0xADD8E6,
            'E': 0x87CEEB, 'F': 0x87CEFA, 'F#': 0x00BFFF, 'G': 0x1E90FF,
            'G#': 0x6495ED, 'A': 0x4682B4, 'A#': 0x5F9EA0, 'B': 0x2F4F4F
        },
        // Species: Sky & Moon (Note-Color Reactivity)
        'sky': {
            'C': 0xFF0000, 'C#': 0xFF7F00, 'D': 0xFFFF00, 'D#': 0x7FFF00,
            'E': 0x00FF00, 'F': 0x00FF7F, 'F#': 0x00FFFF, 'G': 0x007FFF,
            'G#': 0x0000FF, 'A': 0x7F00FF, 'A#': 0xFF00FF, 'B': 0xFF007F
        },
        // Species: Luminous Plants (Deep sea / Bioluminescence)
        'luminous_plants': {
            'C': 0x00FF88, 'C#': 0x00FFCC, 'D': 0x00FFFF, 'D#': 0x00CCFF,
            'E': 0x0088FF, 'F': 0x0044FF, 'F#': 0x4400FF, 'G': 0x8800FF,
            'G#': 0xCC00FF, 'A': 0xFF00FF, 'A#': 0xFF00CC, 'B': 0xFF0088
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
    },

    // Weather music reactivity settings
    weather: {
        musicReactivity: {
            enabled: false,
            blendWeight: 0.6  // 0.0 = no music influence, 1.0 = full override
        }
    },

    // --- PLANT POSE ADSR ENVELOPES ---
    // Controls per-plant sustained/transient response to music and day/night cycle.
    // All values are data-driven so tuning never touches shader or batcher code.
    plantPose: {
        arpeggioFern: {
            attackRate: 3.0,        // unfurl speed per second (fast: responds promptly to arpeggio)
            releaseRate: 0.4,       // fold-back speed per second (slow: sustains open during quiet)
            sustainLevel: 1.0,      // envelope peak = 100 % of dayTarget
            dayTarget: 1.0,         // fully open fronds at mid-day
            nightTarget: 0.0,       // curled closed at night
            triggerThreshold: 0.05  // minimum arpeggio channel volume to trigger attack
        },
        portamentoPine: {
            attackRate: 5.0,        // spring-rest shift speed per second (fast kick with note)
            releaseRate: 0.8,       // settle speed per second (medium: ~1 s to fully release)
            sustainLevel: 0.8,      // envelope peak = 80 % of dayTarget bend
            dayTarget: 0.15,        // slight forward lean when active at day
            nightTarget: -0.05,     // subtle droop at night rest
            triggerThreshold: 0.08, // minimum melody channel volume to trigger bend
            channelIndex: 2         // melody channel (tracker channel 2)
        },
        flower: {
            attackRate: 4.0,        // bloom response to kick
            releaseRate: 1.0,       // settle back down
            sustainLevel: 1.0,      // envelope peak
            dayTarget: 1.0,         // fully blooming during day
            nightTarget: 0.0,       // closed during night
            triggerThreshold: 0.05  // minimum kick channel volume to trigger bloom
        }
    },

    // --- CIRCADIAN SYSTEM ---
    // Controls smooth day/night plant behaviour (pose + bioluminescence).
    // Separate from music-bindings.json — circadian is a time-domain signal, not audio.
    circadian: {
        transitionSeconds: 3.0,
        // uCircadianPoseOffset value at full day (1.0) and full night (0.0).
        // Added to the music-driven pose in opted-in batcher TSL graphs.
        dayPoseOffset: 0.3,
        nightPoseOffset: 0.0,
        // Emissive glow multiplier for luminous plants / mushroom caps at night.
        nightGlowMultiplier: 3.5,
        // Per-biome overrides: any key matching a BiomeId can override the above.
        biomeOverrides: {
            crystalline_nebula: { nightGlowMultiplier: 5.0 },
            arpeggio_grove:     { nightPoseOffset: 0.1 }
        }
    }
};
