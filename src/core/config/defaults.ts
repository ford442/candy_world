import type { ConfigType } from './types.ts';

export const CONFIG: ConfigType = {
    safeMode:
        typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('safe'),
    terrain: {
        useGpuHeightmap: true, // Default to true as it is the goal
        heightmapResolution: 256,
    },

    player: PLAYER_DEFAULTS,
    ground: GROUND_DEFAULTS,

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
        // Species: Sky Islands — pastel candy mist → nebula (cotton, lilac, aurora)
        sky_islands: {
            C: 0xffb6c1,
            'C#': 0xffc0cb,
            D: 0xe6e6fa,
            'D#': 0xdda0dd,
            E: 0xb0e0e6,
            F: 0x87cefa,
            'F#': 0x98fb98,
            G: 0xafeeee,
            'G#': 0xf0e68c,
            A: 0xffe4e1,
            'A#': 0xd8bfd8,
            B: 0xffd1dc,
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
        blinkOnBeat: true,
        blinkDuration: 200, // ms
        blinkInterval: 5000, // ms (average)
        danceAmplitude: 0.2,
        danceFrequency: 1.0, // Hz
    },

    audio: AUDIO_DEFAULTS,

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
        simpleFlower: {
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

    fauna: FAUNA_DEFAULTS,
    presence: PRESENCE_DEFAULTS,

    compute: {
        preferGpu: true,
        foliageGpuBatchMin: 8,
    },
};
