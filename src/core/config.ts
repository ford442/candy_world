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
//   ?no_fauna             — skip ambient fauna boids + batchers
//   ?awakened             — enable durable glow for music-awakened flora (default off)
//   ?presence=1           — show shared-presence opt-in UI (still requires explicit join)
//   ?no_gpu_compute       — force WASM/JS fallback for batch LOD + foliage scalar batches
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

/** Read a *valued* URL flag, e.g. ?postfx=low → 'low'. Returns null when absent. */
function _getFlag(key: string): string | null {
    try {
        return new URLSearchParams(window.location.search).get(key);
    } catch {
        return null; // non-browser (test) environment
    }
}

/**
 * Returns a CI/headless-adjusted count to prevent memory crashes in Playwright/CI.
 * Uses full count in normal browsers, reduced count in CI.
 */
export function getCIAdjustedCount(fullCount: number, ciMultiplier = 0.15, minCount = 5): number {
    if (isCIorHeadless()) {
        const adjusted = Math.max(minCount, Math.floor(fullCount * ciMultiplier));
        console.log(`[CI Adjusted] ${fullCount} → ${adjusted} (multiplier: ${ciMultiplier})`);
        return adjusted;
    }
    return fullCount;
}

export const FEATURE_FLAGS = {
    luminousPlants: !_hasFlag('no_luminous'),
    myceliumRealm: !_hasFlag('no_mycelium'),
    musicalFlora: !_hasFlag('no_musical'),
    proceduralExtras: !_hasFlag('no_procedural'),
    batchers: !_hasFlag('no_batchers'),
    audioReactivity: !_hasFlag('no_audio_react'),
    fireflies: !_hasFlag('no_fireflies'),
    grass: !_hasFlag('no_grass'),
    fauna: !_hasFlag('no_fauna'),
    reliableBoot: !_hasFlag('no_reliable_boot'),
    /**
     * Persist soft glow for music-awakened flora across reloads.
     * Runtime URL flag (?awakened) — default off for safe rollout.
     * Rollup cannot prune this branch; use import.meta.env for zero bundle cost later.
     */
    awakenedPersistence: _hasFlag('awakened'),
    /** Shared multiplayer presence UI + networking (opt-in join; no traffic until joined). */
    presence: _hasFlag('presence') || _getFlag('presence') === '1',
    /**
     * In-browser generative soundtrack (?generative=1 or ?music=generative).
     * Drives music-reactivity from sequencer events instead of FFT/VU analysis.
     */
    generativeMusic: _hasFlag('generative') || _getFlag('music') === 'generative',
    /** Cinematic photo mode (?photo=1 or ?mode=photo). */
    photoMode: _hasFlag('photo') || _getFlag('mode') === 'photo',
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
export const DURATION_PRE_DAWN = 120; // 2 min
export const CYCLE_DURATION =
    DURATION_SUNRISE +
    DURATION_DAY +
    DURATION_SUNSET +
    DURATION_DUSK_NIGHT +
    DURATION_DEEP_NIGHT +
    DURATION_PRE_DAWN; // 960s

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
        /** Visual Impact: soft emissive boost for previously awakened flora (remembered, not noisy) */
        awakenedGlowMultiplier: number;
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
        /**
         * Music source mode:
         * - `tracker` — libopenmpt module playback (default, user-uploaded .mod/.xm)
         * - `generative` — in-browser seeded sequencer (no asset download)
         * - `auto` — generative when FEATURE_FLAGS.generativeMusic, else tracker
         */
        musicMode: 'tracker' | 'generative' | 'auto';
        /** Seed for deterministic generative patterns (0 = default). */
        generativeSeed: number;
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
        biomeOverrides: Record<
            string,
            Partial<{
                transitionSeconds: number;
                dayPoseOffset: number;
                nightPoseOffset: number;
                nightGlowMultiplier: number;
            }>
        >;
    };

    lighting: {
        shadows: {
            enabled: boolean;
            /** Hard off switch (e.g. CI sets via runtime). */
            forceDisable: boolean;
            /** Skip shadows when postfx tier is low (perf mode). */
            disableOnLowPostfx: boolean;
            /** Visual Impact: shadow map resolution at default quality. */
            mapSize: number;
            /** Visual Impact: shadow map resolution when postfx=high. */
            mapSizeHigh: number;
            /** Visual Impact: ortho half-extent — ±followRadius covers player neighborhood. */
            followRadius: number;
            /** Extra ortho margin (render ±(followRadius+snapHeadroom)) for texel-snap headroom. */
            snapHeadroom: number;
            /** Light placed at player + normalizedSunDir * sunDistance. */
            sunDistance: number;
            cameraNear: number;
            cameraFar: number;
            /** Depth bias — reduces acne on glossy MeshPhysicalMaterial. */
            bias: number;
            normalBias: number;
            /** PCF soft shadow filter radius. */
            pcfRadius: number;
        };
    };

    atmosphere: {
        fog: {
            /** Visual Impact: day near as ratio of camera.far (≈20u at far=2000). */
            nearRatio: number;
            /** Visual Impact: day far as ratio of camera.far (≈320u at far=2000). */
            farRatio: number;
            nightNearRatio: number;
            nightFarRatio: number;
            minNear: number;
            maxNear: number;
            minFar: number;
            maxFar: number;
            /** Visual Impact: cap near so foreground (<30u) stays crisp. */
            maxForegroundNear: number;
            minSpan: number;
            fovScale: number;
            referenceFov: number;
            altitudeBaseline: number;
            /** Extra fog far per meter above altitudeBaseline (vantage / cloud pads). */
            altitudeScale: number;
            /** Cap far as ratio of camera.far — aligns with sky horizon band. */
            horizonFarCap: number;
            /** Exponential lerp rate for near/far transitions (frame-rate aware). */
            lerpSpeed: number;
        };
    };

    /**
     * Player avatar / first-person camera height tuning.
     * eyeHeight is added to the authoritative ground height to place the camera.
     * spawnEyeHeightY is the transient starting height before the first ground snap.
     */
    player: {
        eyeHeight: number;
        spawnEyeHeightY: number;
    };

    /**
     * Ground-follow tuning. The camera/player Y is lerped toward the authoritative
     * ground height + eyeHeight to avoid snapping over small terrain bumps.
     */
    ground: {
        followLerpSpeed: number;
        followMaxStep: number;
        /** Eye Y above terrain before we treat the player as standing on a platform. */
        platformElevationThreshold: number;
        cacheCellSize: number;
        cacheTTL: number;
        /** Perimeter samples for circular footprint queries (center is always included). */
        footprintSamples: number;
        /** Max tilt from world-up when aligning props to terrain slope (radians). */
        maxSlopeAngle: number;
        /** Per-entity footprint radius (world units). 0 / absent = single-point sample. */
        footprintRadius: Record<string, number>;
        /** Footprint Y policy: `min` = lowest contact (trees/rocks), `avg` = level pads. */
        footprintPlacementY: Record<string, 'min' | 'avg'>;
    };

    /** Walkable cloud platform tuning (#1266). */
    cloud: {
        defaultSize: number;
        sizePresets: { small: number; medium: number; large: number };
        /** Grid snap for dev placement (0 = off). */
        gridSnap: number;
        snapY: boolean;
        placementRayDistance: number;
        /** Default float height when raycast misses geometry. */
        defaultFloatHeight: number;
        /** Small lift applied on raycast hits so clouds sit on surfaces. */
        surfaceYOffset: number;
        walkableTier: number;
        /** Visual Impact: candy pastel cloud palette */
        pastelTint: number;
        creamHighlight: number;
        lavenderShadow: number;
        emissivePulse: number;
    };

    world: {
        /** Shareable procedural seed — matches map.json metadata when unset in URL. */
        seed: number;
        population: {
            proceduralExtras: number;
            arpeggioGroveFerns: number;
            arpeggioGroveOuter: number;
            lakeArpeggioFerns: number;
            lakeDandelions: number;
            scale: number;
        };
        /** Single source of truth for procedural instance scale / height sampling. */
        scaleTable: Record<string, EntityScaleEntry>;
        /** Subtle forced-perspective shrink toward biome outer radius. */
        scaleDistanceBias: {
            enabled: boolean;
            /** Max scale reduction at normalizedDistance = 1 (e.g. 0.08 → 8% smaller). */
            outerShrink: number;
        };
    };

    foliage: {
        lod: {
            enabled: boolean;
            heroMax: number;
            midMax: number;
            blendWidth: number;
            blendSeconds: number;
            farCull: number;
            useImpostors: boolean;
            impostorMinFactor: number;
            impostorMaxFactor: number;
            impostorScaleMul: number;
            impostorAspect: number;
        };
        aerialPerspective: {
            enabled: boolean;
            /** Visual Impact: master blend — 0.85 reads natural without greying heroes. */
            strength: number;
            /** Visual Impact: first distance (units) where recession begins. */
            startDist: number;
            /** Visual Impact: full atmospheric blend distance (horizon tree line). */
            endDist: number;
            /** Visual Impact: desaturation amount at far end (0–1). */
            desatAmount: number;
            /** Visual Impact: fog-color lift at far end (0–1). */
            fogBlend: number;
            /** Visual Impact: strength retained at night when linear fog is already tight. */
            nightFactor: number;
        };
        /** Ground-contact ambient-occlusion-style darkening on diffuse (not emissive). */
        baseContactAO: {
            enabled: boolean;
            /** Visual Impact: 0.25–0.4 reads grounded without muddy bases. */
            strength: number;
            /** Extra strength at night for moonlit grounding. */
            nightBoost: number;
            groundTint: number;
            contactHeight: Record<string, number> & { _default: number };
        };
    };

    fauna: {
        enabled: boolean;
        maxInstances: number;
        maxPerSpecies: number;
        seed: number;
        areaScale: number;
        biomeDensity: Record<string, { beetle: number; hopper: number; moth: number }>;
    };

    presence: {
        /** Master enable — also requires FEATURE_FLAGS.presence and Supabase env vars. */
        enabled: boolean;
        maxPeers: number;
        tickHz: number;
        cullDistance: number;
    };

    compute: {
        /** Prefer GPU compute over WASM/JS when WebGPU is ready (Tier 4 default). */
        preferGpu: boolean;
        /** Minimum batch size before foliage scalar work moves to GPU. */
        foliageGpuBatchMin: number;
    };

    postfx: {
        quality: 'off' | 'low' | 'high';
        godRays: boolean;
        /** Max combined shaft opacity (golden hour + melody). Visual Impact: 0.4 keeps beams dreamy, not blinding. */
        shaftOpacityCap: number;
        /** Min dot(cameraForward, celestialDir) before shafts render (performance frustum gate). */
        shaftFrustumDot: number;
        /** Bloom scatter boost at full shaft opacity (0 = off). Pairs with additive shaft planes. */
        shaftScatterBoost: number;
        dofEnabled: boolean;
        dofFocusFollow: boolean;
        dofFocusDistance: number;
        dofAperture: number;
        dofMaxBlur: number;
        dofProximity: number;
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

    console.log(
        '[DEBUG] isCIorHeadless →',
        result ? 'TRUE ✓' : 'FALSE ✗',
        checks,
        'URL=',
        window.location.href
    );

    return result;
};

export const CONFIG: ConfigType = {
    safeMode:
        typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('safe'),
    terrain: {
        useGpuHeightmap: true, // Default to true as it is the goal
        heightmapResolution: 256,
    },

    // --- PLAYER / CAMERA HEIGHT ---
    // Issue #1265: centralised eye height and ground-follow tuning so the
    // first-person camera no longer snaps over small terrain bumps.
    player: {
        eyeHeight: 1.8, // Height of the camera above the ground surface
        spawnEyeHeightY: 5.0, // Transient camera Y before the first authoritative ground snap
    },
    ground: {
        followLerpSpeed: 12.0, // Units/sec for smoothing eye height over terrain bumps
        followMaxStep: 2.5, // Max vertical change per frame to prevent huge jumps
        platformElevationThreshold: 1.25, // Above terrain eye Y → trust physics (clouds, pads)
        cacheCellSize: 2.0, // GroundSystem height-cache cell size (0.01-unit quantised)
        cacheTTL: 1.0, // Seconds before a cached height sample expires
        footprintSamples: 4, // Perimeter ring samples (+ center) for wide-prop grounding
        maxSlopeAngle: (25 * Math.PI) / 180,
        footprintRadius: {
            tree: 0.4,
            shrub: 0.4,
            portamento_pine: 0.5,
            bubble_willow: 0.6,
            balloon_bush: 0.6,
            helix_plant: 0.4,
            gem_canopy_tree: 0.6,
            subwoofer_lotus: 0.7,
            kick_drum_geyser: 0.5,
            snare_trap: 0.5,
            instrument_shrine: 0.6,
            panning_pad: 0.5,
            mushroom: 0.25,
            retrigger_mushroom: 0.35,
            glass_mushroom: 0.25,
            rock: 0.3,
            grass: 0.15,
        },
        footprintPlacementY: {
            panning_pad: 'avg',
            subwoofer_lotus: 'avg',
        },
    },

    cloud: {
        defaultSize: 1.5,
        sizePresets: { small: 1.0, medium: 1.5, large: 2.2 },
        gridSnap: 2.0,
        snapY: false,
        placementRayDistance: 40,
        defaultFloatHeight: 12,
        surfaceYOffset: 0.15,
        walkableTier: 1,
        // Visual Impact: dreamy candy cloud pastels (lavender / pink / cream)
        pastelTint: 0xffd1dc,
        creamHighlight: 0xfff8e7,
        lavenderShadow: 0xe6e6fa,
        emissivePulse: 0.35,
    },

    colors: {
        ground: 0x222222,
        fog: 0x1a1a2e,
    },

    // --- NEW INTERACTION SETTINGS ---
    interaction: {
        maxDistance: 60, // Raycast max range
        proximityRadius: 12.0, // Object "wakes up"
        interactionDistance: 8.0, // Object becomes clickable
    },

    // --- TWILIGHT GLOW SETTINGS ---
    glow: {
        startOffsetMinutes: 30, // Start glowing 30 min before sunset
        endOffsetMinutes: 30, // Stop glowing 30 min after sunrise (or before? usually before dawn, but let's stick to plan)
        glowPulseFrequency: 1.0,
        glowPulseAmplitude: 0.5,
        glowIntensityMax: 2.0,
        awakenedGlowMultiplier: 0.5,
        glowColorMap: {
            mushroom: 0xffdddd,
            tree: 0xaaffcc,
            flower: 0xffccee,
            dandelion: 0xffffaa,
            wisteria: 0xddaaff,
            lotus: 0xffbbcc,
            lantern: 0xffeeaa,
            portamento: 0xaaeeff,
            global: 0xffffff,
            luminous_plants: 0x66ccff,
        },
    },

    // --- LUMINOUS PLANTS SETTINGS ---
    luminousPlants: {
        density: 150,
        baseGlowIntensity: 1.0,
        peakGlowIntensity: 3.5,
        pulseSpeed: 1.5,
        pulseDepth: 0.3,
        subsurfaceStrength: 0.8,
        glowIntensity: 2.0,
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
        seed: 12345,
        population: {
            // Scattered procedural objects across the world (mushrooms, flowers, trees, clouds, etc.)
            proceduralExtras: 220, // Reduced from 400 for faster Full mode loads

            // Main Arpeggio Grove setpiece (near -60,60)
            arpeggioGroveFerns: 7, // Reduced from 12
            arpeggioGroveOuter: 4, // Reduced from 8 (geysers + violets)

            // Secondary Arpeggio-style foliage on the lake island
            lakeArpeggioFerns: 3, // Reduced from 5
            lakeDandelions: 6, // Reduced from 10

            // Global multiplier for quick experimentation (1.0 = use the numbers above)
            // Set to 0.5 for a very light Full mode, or 1.5 if you have a powerful machine.
            scale: 1.0,
        },
        // Procedural scale table — reference heights at `base` (world units):
        //   tree trunk 4–6u | mushroom cap 1–2u | fern 1.2–1.6u | dandelion ~0.9u | gem fruit ~0.25u
        // Variance clamped to 0.7×–1.5× of `base` unless a biome override widens it.
        scaleTable: {
            _default: { base: 1.0, min: 0.85, max: 1.15 },

            mushroom: { base: 1.0, min: 0.85, max: 1.15, refHeight: 1.2 },
            glass_mushroom: {
                base: 1.0,
                min: 0.85,
                max: 1.15,
                refHeight: 1.4,
                biomeOverrides: { mycelium_grove: { min: 0.9, max: 1.1 } },
            },
            retrigger_mushroom: { base: 1.0, min: 0.85, max: 1.15, refHeight: 1.3 },

            tree: { base: 1.0, min: 0.9, max: 1.1, refHeight: 5.0 },
            bubble_willow: { base: 1.0, min: 0.9, max: 1.1, refHeight: 5.5 },
            balloon_bush: { base: 1.0, min: 0.9, max: 1.1, refHeight: 4.5 },
            helix_plant: { base: 1.0, min: 0.9, max: 1.1, refHeight: 4.0 },
            portamento_pine: {
                base: 1.0,
                min: 0.9,
                max: 1.1,
                refHeight: 5.0,
                height: { base: 5.0, min: 4.2, max: 5.8 },
            },
            gem_canopy_tree: {
                base: 1.0,
                min: 0.9,
                max: 1.1,
                refHeight: 5.0,
                height: { base: 5.0, min: 4.5, max: 5.5 },
                biomeOverrides: { gem_canopy: { height: { base: 5.2, min: 4.8, max: 5.8 } } },
            },

            arpeggio_fern: {
                base: 1.0,
                min: 0.9,
                max: 1.1,
                refHeight: 1.5,
                biomeOverrides: { arpeggio_grove: { min: 0.95, max: 1.1 } },
            },
            cymbal_dandelion: { base: 0.9, min: 0.8, max: 1.0, refHeight: 0.9 },
            snare_trap: { base: 0.9, min: 0.8, max: 1.0, refHeight: 0.8 },
            luminous_plant: { base: 1.0, min: 0.85, max: 1.15, refHeight: 1.8 },
            gem_fruit: {
                base: 1.0,
                min: 0.85,
                max: 1.15,
                refHeight: 0.25,
                biomeOverrides: { gem_canopy: { min: 0.9, max: 1.1 } },
            },

            flower: { base: 1.0, min: 0.85, max: 1.15, refHeight: 0.6 },
            rock: { base: 1.15, min: 1.0, max: 1.3, refHeight: 0.8 },
            tremolo_tulip: { base: 1.0, min: 0.85, max: 1.15, refHeight: 1.0 },
            vibrato_violet: { base: 1.0, min: 0.85, max: 1.15, refHeight: 0.8 },
            kick_drum_geyser: {
                base: 1.0,
                min: 0.9,
                max: 1.1,
                refHeight: 6.0,
                height: { base: 6.0, min: 5.0, max: 7.5 },
            },

            cloud: { base: 1.0, min: 0.85, max: 1.15, refHeight: 12 },
            cloud_tier1: { base: 1.5, min: 1.35, max: 1.5, refHeight: 35 },
            cloud_tier2: { base: 0.9, min: 0.8, max: 1.0, refHeight: 12 },

            instrument_shrine: { base: 1.0, min: 0.9, max: 1.1, refHeight: 2.5 },
            silence_spirit: { base: 1.0, min: 0.9, max: 1.1, refHeight: 1.2 },
        },
        scaleDistanceBias: {
            enabled: true,
            outerShrink: 0.08,
        },
    },

    // --- NOTE COLOR MAPPING ---
    noteColorMap: {
        // Standard Global Palette (Fallback) - matching assets/colorcode.json
        global: {
            C: 0xff0000,
            'C#': 0xff7f00,
            D: 0xffff00,
            'D#': 0x7fff00,
            E: 0x00ff00,
            F: 0x00ff7f,
            'F#': 0x00ffff,
            G: 0x007fff,
            'G#': 0x0000ff,
            A: 0x7f00ff,
            'A#': 0xff00ff,
            B: 0xff007f,
        },
        // Species: Mushroom (Shader-matched palette)
        mushroom: {
            C: 0xff0000,
            'C#': 0xff7f00,
            D: 0xffff00,
            'D#': 0x7fff00,
            E: 0x00ff00,
            F: 0x00ff7f,
            'F#': 0x00ffff,
            G: 0x007fff,
            'G#': 0x0000ff,
            A: 0x7f00ff,
            'A#': 0xff00ff,
            B: 0xff007f,
        },
        // Species: Flower (Vibrant Pastels)
        flower: {
            C: 0xff0000,
            'C#': 0xff7f00,
            D: 0xffff00,
            'D#': 0x7fff00,
            E: 0x00ff00,
            F: 0x00ff7f,
            'F#': 0x00ffff,
            G: 0x007fff,
            'G#': 0x0000ff,
            A: 0x7f00ff,
            'A#': 0xff00ff,
            B: 0xff007f,
        },
        // Species: Tree (Nature + Biolum)
        tree: {
            C: 0xff0000,
            'C#': 0xff7f00,
            D: 0xffff00,
            'D#': 0x7fff00,
            E: 0x00ff00,
            F: 0x00ff7f,
            'F#': 0x00ffff,
            G: 0x007fff,
            'G#': 0x0000ff,
            A: 0x7f00ff,
            'A#': 0xff00ff,
            B: 0xff007f,
        },
        // Species: Cloud (Ethereal candy pastels — lavender / pink / cream)
        cloud: {
            C: 0xffd1dc,
            'C#': 0xffe4e1,
            D: 0xfff0f5,
            'D#': 0xe6e6fa,
            E: 0xdda0dd,
            F: 0xf0e6ff,
            'F#': 0xfff8e7,
            G: 0xffe4c4,
            'G#': 0xffb6c1,
            A: 0xffc0cb,
            'A#': 0xe0b0ff,
            B: 0xc8a2c8,
        },
        // Species: Sky & Moon (Note-Color Reactivity)
        sky: {
            C: 0xff0000,
            'C#': 0xff7f00,
            D: 0xffff00,
            'D#': 0x7fff00,
            E: 0x00ff00,
            F: 0x00ff7f,
            'F#': 0x00ffff,
            G: 0x007fff,
            'G#': 0x0000ff,
            A: 0x7f00ff,
            'A#': 0xff00ff,
            B: 0xff007f,
        },
        // Species: Luminous Plants (Deep sea / Bioluminescence)
        luminous_plants: {
            C: 0x00ff88,
            'C#': 0x00ffcc,
            D: 0x00ffff,
            'D#': 0x00ccff,
            E: 0x0088ff,
            F: 0x0044ff,
            'F#': 0x4400ff,
            G: 0x8800ff,
            'G#': 0xcc00ff,
            A: 0xff00ff,
            'A#': 0xff00cc,
            B: 0xff0088,
        },
        // Species: Gem Canopy — jewel tones (ruby, sapphire, amethyst, emerald…)
        gem_canopy: {
            C: 0xe0115f,
            'C#': 0xff4d6d,
            D: 0xff6b9d,
            'D#': 0x9966cc,
            E: 0x7b68ee,
            F: 0x0f52ba,
            'F#': 0x4169e1,
            G: 0x00ced1,
            'G#': 0x2e8b57,
            A: 0x50c878,
            'A#': 0xffd700,
            B: 0xff69b4,
        },
    },

    // Per-species reaction tuning
    reactivity: {
        mushroom: {
            medianWindow: 5,
            smoothingRate: 8,
            scale: 0.6,
            maxAmplitude: 1.0,
            minThreshold: 0.02,
        },
        cloud: {
            medianWindow: 4,
            smoothingRate: 10,
            scale: 0.45,
            maxAmplitude: 0.8,
            minThreshold: 0.015,
        },
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
        danceFrequency: 1.0, // Hz
    },

    // Audio processing settings
    audio: {
        // Use ScriptProcessorNode for compatibility mode (deprecated but more reliable in some cases)
        // Set to true if experiencing AudioWorkletNode performance issues or slow loading
        // Default: false (uses modern AudioWorkletNode)
        // See AUDIO_COMPATIBILITY_MODE.md for more information
        useScriptProcessorNode: false,
        // Music source: tracker (libopenmpt) or generative (Web Audio sequencer)
        musicMode: 'auto' as 'tracker' | 'generative' | 'auto',
        generativeSeed: 0,
    },

    // Weather music reactivity settings
    weather: {
        musicReactivity: {
            enabled: false,
            blendWeight: 0.6, // 0.0 = no music influence, 1.0 = full override
        },
    },

    // --- PLANT POSE ADSR ENVELOPES ---
    // Controls per-plant sustained/transient response to music and day/night cycle.
    // All values are data-driven so tuning never touches shader or batcher code.
    plantPose: {
        arpeggioFern: {
            attackRate: 3.0, // unfurl speed per second (fast: responds promptly to arpeggio)
            releaseRate: 0.4, // fold-back speed per second (slow: sustains open during quiet)
            sustainLevel: 1.0, // envelope peak = 100 % of dayTarget
            dayTarget: 1.0, // fully open fronds at mid-day
            nightTarget: 0.0, // curled closed at night
            triggerThreshold: 0.05, // minimum arpeggio channel volume to trigger attack
        },
        portamentoPine: {
            attackRate: 5.0, // spring-rest shift speed per second (fast kick with note)
            releaseRate: 0.8, // settle speed per second (medium: ~1 s to fully release)
            sustainLevel: 0.8, // envelope peak = 80 % of dayTarget bend
            dayTarget: 0.15, // slight forward lean when active at day
            nightTarget: -0.05, // subtle droop at night rest
            triggerThreshold: 0.08, // minimum melody channel volume to trigger bend
            channelIndex: 2, // melody channel (tracker channel 2)
        },
        flower: {
            attackRate: 4.0, // bloom response to kick
            releaseRate: 1.0, // settle back down
            sustainLevel: 1.0, // envelope peak
            dayTarget: 1.0, // fully blooming during day
            nightTarget: 0.0, // closed during night
            triggerThreshold: 0.05, // minimum kick channel volume to trigger bloom
        },
    },

    // --- FOLIAGE LOD (three-tier batcher system) ---
    // Hero 0–heroMax: full TSL; mid heroMax–midMax: simplified; far midMax+: proxy collapse + impostors
    foliage: {
        lod: {
            enabled: true,
            heroMax: 120,
            midMax: 365,
            /** Cross-fade zone width (units) at each tier boundary */
            blendWidth: 30,
            /** Temporal blend duration at tier boundaries (seconds) */
            blendSeconds: 0.5,
            /** Distance beyond which instances are frustum/distance culled */
            farCull: 480,
            /** Shared far-tier billboard impostor layer */
            useImpostors: true,
            /** Cross-fade begins — mesh dithers out as impostor dithers in */
            impostorMinFactor: 1.55,
            impostorMaxFactor: 2.05,
            /** Visual Impact: billboard size ≈ instance bounds × this at handoff */
            impostorScaleMul: 2.15,
            impostorAspect: 1.12,
        },
        aerialPerspective: {
            enabled: true,
            strength: 0.85,
            startDist: 35,
            endDist: 130,
            desatAmount: 0.62,
            fogBlend: 0.42,
            nightFactor: 0.12,
        },
        // Ground-contact AO — height-based diffuse darkening at instance bases (#1307)
        baseContactAO: {
            enabled: true,
            strength: 0.32,
            nightBoost: 0.25,
            groundTint: 0x1a1410,
            // Local mesh Y units from instance base (y=0); pairs with placement-utils (#1303)
            contactHeight: {
                _default: 0.25,
                tree: 0.22,
                mushroom: 0.35,
                arpeggio_fern: 0.45,
                luminous_plant: 0.5,
                portamento_pine: 0.22,
            },
        },
    },

    // --- AMBIENT FAUNA (boids + instanced critters) ---
    fauna: {
        enabled: true,
        /** Total instance cap across all species (documented perf budget). */
        maxInstances: 96,
        /** Per-species cap (beetle / hopper / moth). */
        maxPerSpecies: 40,
        seed: 42,
        areaScale: 1.0,
        biomeDensity: {
            arpeggio_grove: { beetle: 8, hopper: 6, moth: 4 },
            crystalline_nebula: { beetle: 4, hopper: 3, moth: 10 },
            luminous_plants: { beetle: 5, hopper: 4, moth: 8 },
            gem_canopy: { beetle: 6, hopper: 5, moth: 3 },
            lake_features: { beetle: 3, hopper: 2, moth: 5 },
            global: { beetle: 5, hopper: 4, moth: 4 },
        },
    },

    presence: {
        enabled: true,
        maxPeers: 16,
        tickHz: 10,
        cullDistance: 120,
    },

    compute: {
        preferGpu: true,
        foliageGpuBatchMin: 8,
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
            arpeggio_grove: { nightPoseOffset: 0.1 },
        },
    },

    // -----------------------------------------------------------------------
    // Atmospheric post-FX (god rays + depth of field).
    //
    // Quality tier — override at runtime with ?postfx=off|low|high :
    //   off  — no god rays, no DoF (cheapest; for low-end GPUs / debugging)
    //   low  — god rays ON, DoF OFF   ← DEFAULT first boot (60fps budget)
    //   high — god rays ON, DoF ON near luminous / mycelium flora
    //
    // God rays themselves live in game-loop.ts (sunrise/sunset/moon shafts,
    // music-driven opacity). DoF is a bokeh pass added to post-processing.ts.
    // DoF is only *built into* the render graph when enabled at boot, so the
    // default `low` tier carries zero DoF cost.
    // -----------------------------------------------------------------------
    postfx: {
        /** 'off' | 'low' | 'high'. URL override: ?postfx=<tier>. */
        quality: 'low' as 'off' | 'low' | 'high',
        /** Master toggle for sunrise/sunset/moon god-ray shafts. */
        godRays: true,
        /** Visual Impact: opacity cap — prevents multi-second GPU stalls from over-bright additive stacks. */
        shaftOpacityCap: 0.4,
        /** Performance: shafts hidden when sun/moon is behind the camera (dot threshold). */
        shaftFrustumDot: 0.28,
        /** Screen-space bloom swell when shafts are visible (radial-scatter feel without a second pass). */
        shaftScatterBoost: 0.45,
        /**
         * Force-enable DoF independent of tier (also ?dof / ?no_dof URL flags).
         * Resolved via isDofEnabled(); 'high' tier implies DoF on.
         */
        dofEnabled: false,
        /** Focus distance (world units) follows the camera look vector when true. */
        dofFocusFollow: true,
        /** Resting focus distance (units) used when focus-follow is disabled. */
        dofFocusDistance: 9.0,
        /** Aperture — candy bokeh: subtle, not clinical. Higher = stronger blur falloff. */
        dofAperture: 0.015,
        /** Max blur clamp (0–1) — keeps the look soft, never smeared. */
        dofMaxBlur: 0.5,
        /** Distance (units) from luminous / mycelium flora that auto-engages DoF. */
        dofProximity: 14.0,
    },

    // --- SUN SHADOWS (player-following ortho) ---
    lighting: {
        shadows: {
            enabled: true,
            forceDisable: false,
            disableOnLowPostfx: false,
            mapSize: 1024,
            mapSizeHigh: 2048,
            followRadius: 40,
            snapHeadroom: 2,
            sunDistance: 100,
            cameraNear: 1,
            cameraFar: 200,
            bias: -0.0005,
            normalBias: 0.02,
            pcfRadius: 2,
        },
    },

    // --- ATMOSPHERIC FOG (camera-derived distances) ---
    atmosphere: {
        fog: {
            nearRatio: 0.01,
            farRatio: 0.16,
            nightNearRatio: 0.0025,
            nightFarRatio: 0.04,
            minNear: 6,
            maxNear: 26,
            minFar: 120,
            maxFar: 420,
            maxForegroundNear: 28,
            minSpan: 50,
            fovScale: 0.75,
            referenceFov: 60,
            altitudeBaseline: 1.8,
            altitudeScale: 2.5,
            horizonFarCap: 0.21,
            lerpSpeed: 3.0,
        },
    },
};

// ---------------------------------------------------------------------------
// Post-FX resolution helpers — read URL overrides on top of CONFIG.postfx.
// Defined after CONFIG so they can reference it; only ever called at runtime.
// ---------------------------------------------------------------------------

/** Effective post-FX quality tier (URL ?postfx= wins over CONFIG default). */
export function resolvePostfxQuality(): 'off' | 'low' | 'high' {
    const q = _getFlag('postfx');
    if (q === 'off' || q === 'low' || q === 'high') return q;
    return CONFIG.postfx.quality;
}

/** Whether sunrise/sunset/moon god-ray shafts should render this session. */
export function areGodRaysEnabled(): boolean {
    if (resolvePostfxQuality() === 'off') return false;
    return CONFIG.postfx.godRays;
}

/**
 * Whether the Depth-of-Field bokeh pass should be built into the pipeline.
 * ?no_dof force-off wins; ?dof force-on next; otherwise the 'high' tier or the
 * CONFIG.postfx.dofEnabled flag enables it.
 */
export function isDofEnabled(): boolean {
    if (_hasFlag('no_dof')) return false;
    if (_hasFlag('dof')) return true;
    return resolvePostfxQuality() === 'high' || CONFIG.postfx.dofEnabled;
}

/**
 * Manual (always-on) DoF — not gated by flora proximity. True when force-enabled
 * via ?dof or CONFIG.postfx.dofEnabled; the 'high' tier alone stays proximity-driven.
 */
export function isDofManual(): boolean {
    if (_hasFlag('no_dof')) return false;
    return _hasFlag('dof') || CONFIG.postfx.dofEnabled;
}

export interface ShadowSettings {
    enabled: boolean;
    mapSize: number;
}

/**
 * Whether directional sun shadows are active and at what map resolution.
 * Disabled on CI/headless, postfx=off, or CONFIG.lighting.shadows.enabled=false.
 */
export function resolveShadowSettings(): ShadowSettings {
    const cfg = CONFIG.lighting.shadows;
    if (!cfg.enabled || cfg.forceDisable || isCIorHeadless()) {
        return { enabled: false, mapSize: 0 };
    }

    const quality = resolvePostfxQuality();
    if (quality === 'off') {
        return { enabled: false, mapSize: 0 };
    }
    if (quality === 'low' && cfg.disableOnLowPostfx) {
        return { enabled: false, mapSize: 0 };
    }

    const mapSize = quality === 'high' ? cfg.mapSizeHigh : cfg.mapSize;
    return { enabled: true, mapSize };
}
