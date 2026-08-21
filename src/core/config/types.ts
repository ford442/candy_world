import type { PlantPoseConfig } from '../../foliage/plant-pose-machine.ts';
import type { EntityScaleEntry } from './palette.ts';

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
        blinkOnBeat: boolean;
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
        /** Shared by SimpleFlowerBatcher — same diurnal open/close as flower. */
        simpleFlower: PlantPoseConfig;
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

            // --- Cascaded Shadow Maps (WebGPU only; WebGL keeps the single follow map) ---
            /** Master switch for CSM. False → the legacy single player-following ortho map. */
            cascadesEnabled: boolean;
            /** Visual Impact: cascade count at default quality. Clamped to 2–4. */
            cascadeCount: number;
            /** Visual Impact: cascade count when the shadow tier is high. Clamped to 2–4. */
            cascadeCountHigh: number;
            /** Split scheme across the camera frustum. 'practical' blends uniform + logarithmic. */
            cascadeMode: 'practical' | 'uniform' | 'logarithmic';
            /**
             * Visual Impact: far clip for cascade splits, in world units. Bounds how much of
             * the (very long) camera frustum the cascades cover — keep near the fog far plane
             * so the last cascade does not waste texels past visible range.
             */
            cascadeMaxFar: number;
            /** Distance the cascade light is pushed back along the sun direction. */
            cascadeLightMargin: number;
            /** Cross-fade cascade seams. Slightly softer, slightly more expensive. */
            cascadeFade: boolean;
            /**
             * Halve the shadow map for each successive (farther) cascade, floored at
             * `cascadeMapSizeMin`. Near cascade keeps the full `mapSize`, so the
             * high tier spends 2048 only where the player actually looks. Roughly
             * halves total shadow VRAM versus a flat allocation.
             */
            cascadeMapSizeTaper: boolean;
            /** Lower bound for tapered far-cascade shadow maps. */
            cascadeMapSizeMin: number;
        };
        /**
         * First-class local point/spot lights (not the sun). Generation must
         * register through `src/rendering/lights.ts` so clustered culling can
         * see every extra light. Decorative fills (flower heads, orbs) are
         * descriptors only — they do not allocate GPU lights.
         */
        maxClusterLights?: number;
        maxLightsPerCluster?: number;
        local: {
            /** Visual Impact: pastel point fill intensity (candela-ish). */
            pointIntensity: number;
            /** Visual Impact: inverse-square cutoff distance, world units. */
            pointDistance: number;
            /** Physical decay exponent. 2 = inverse-square. */
            pointDecay: number;
            /** Visual Impact: default candy cyan fill (hex). */
            pointColor: number;
            /** Visual Impact: mushroom-cap / cone fill intensity. */
            spotIntensity: number;
            /** Visual Impact: spot range, world units. */
            spotDistance: number;
            spotDecay: number;
            /** Visual Impact: cone half-angle in radians. */
            spotAngle: number;
            /** Visual Impact: cone edge softness 0–1. */
            spotPenumbra: number;
            /** Visual Impact: default candy pink cone (hex). */
            spotColor: number;
            /**
             * Extra shadow-casting local lights on top of the sun. 0–2.
             * Clustered lighting will consume the rest as unshadowed.
             */
            maxLocalShadowLights: number;
            /** Visual Impact: local (point/spot) shadow map resolution. */
            localShadowMapSize: number;
            /** Skip extra local shadow maps on the `low` graphics tier / CI. */
            disableOnLow: boolean;
            localShadowBias: number;
            localShadowNormalBias: number;
            localShadowNear: number;
            localShadowFar: number;
        };
        /**
         * Lightweight GI — a player-following SH-L1 irradiance probe volume,
         * baked on the CPU from sky openness, ground bounce and the local-light
         * registry, then added to unified materials as a soft coloured bounce.
         * @see docs/IRRADIANCE_PROBES.md
         */
        gi: {
            enabled: boolean;
            /** Hard off switch that beats every tier / URL flag. */
            forceDisable: boolean;
            /** Skip the volume on the `low` graphics tier (WebGL / CI clamp to it). */
            disableOnLow: boolean;

            /** Probe count per axis at default quality. Clamped to 2–32. */
            gridX: number;
            gridY: number;
            gridZ: number;
            /** Probe count per axis when the graphics tier is high. */
            gridXHigh: number;
            gridYHigh: number;
            gridZHigh: number;
            /** Visual Impact: world units between probes. Extent = grid * cellSize. */
            cellSize: number;
            cellSizeHigh: number;
            /** Bake budget per frame, nearest-to-camera first. */
            probesPerFrame: number;
            probesPerFrameHigh: number;
            /** Local lights considered as bounce donors per bake pass. */
            maxDonors: number;

            /** Visual Impact: master gain on the bounce term. 0 restores the pre-GI look. */
            intensity: number;
            /** Visual Impact: how much of the directional (L1) band reaches the surface. */
            directionality: number;
            /** Largest irradiance the RGBA8 probe textures can encode. */
            range: number;
            /** Visual Impact: weight of the overhead sky term. */
            skyStrength: number;
            /** Visual Impact: weight of the sun-off-terrain bounce. */
            groundBounce: number;
            /** Candy ground albedo used by that bounce (hex). */
            groundAlbedo: number;
            /** Height in world units over which ground bounce falls off. */
            groundFalloff: number;
            /** Visual Impact: weight of registered local lights as bounce donors. */
            donorStrength: number;
            /** Donors reach a little past their light radius — bounce is not a light. */
            donorRadiusScale: number;

            /** Blend toward `pastelSaturation` so bounce never reads as grey dirt. */
            pastelBias: number;
            /** Visual Impact: saturation floor the pastel guard pulls bounce toward. */
            pastelSaturation: number;
            /** Visual Impact: icy fill so sugar-cave interiors are dim, not black (hex). */
            caveFill: number;
            caveFillStrength: number;
            /** Fraction of the volume used to fade GI out at its border. */
            edgeFade: number;
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
     * spawnX / spawnZ is the Play-path start on solid shore (not Melody Lake / cave floor).
     */
    player: {
        eyeHeight: number;
        spawnEyeHeightY: number;
        spawnX: number;
        spawnZ: number;
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
        /** Matches `assets/map.json` metadata.seed. */
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

    /** Ambient fauna (WASM boids + instanced critters). */
    fauna: {
        enabled: boolean;
        maxInstances: number;
        maxPerSpecies: number;
        seed: number;
        areaScale: number;
        biomeDensity: Record<string, { beetle: number; hopper: number; moth: number }>;
        /** Sky-island roost flocks (#1363) — reserved slice of the population. */
        roosts: {
            enabled: boolean;
            /** Critters placed per registered island deck. */
            perIsland: number;
            /** Ring radius as a fraction of deck radius (keeps roosts off the rim). */
            ringInset: number;
            /** Random offset as a fraction of deck radius. */
            jitter: number;
            /** Species mix at roosts — moth-heavy; flyers suit floating decks. */
            density: { beetle: number; hopper: number; moth: number };
        };
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
}
