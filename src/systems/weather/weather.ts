// src/systems/weather/weather.ts
// Core WeatherSystem orchestrator - delegates to specialized managers

import * as THREE from 'three';
import { VisualState } from '../../audio/audio-system.ts';
import { camera } from '../../core/camera-ref.ts';
import { CYCLE_DURATION, DURATION_SUNRISE, DURATION_DAY, CONFIG } from '../../core/config.ts';
import * as Cycle from '../../core/cycle.ts';
import { getDayNightBias } from '../../core/cycle.ts';
import { triggerGrowth } from '../../foliage/animation.ts';
import { BerryBatcher } from '../../foliage/berries.ts';
import { updateCaveWaterLevel } from '../../foliage/cave.ts';
import { uTwilight } from '../../foliage/sky.ts';
import { waterfallBatcher } from '../../foliage/waterfall-batcher.ts';
import { computeAtmosphereFogTargets } from '../atmosphere-fog.ts';
import { WeatherMusicTargets } from '../music-reactivity.ts';
import { announce } from '../../ui/announcer.ts';
import { SEASON_NAMES, type SeasonName, type SeasonState } from '../season-core.ts';
import { WeatherState } from '../weather-types.ts';
import { rainFlavour } from '../weather-utils.ts';
import { AtmosphereManager } from './weather-atmosphere.ts';
import { EcosystemManager } from './weather-ecosystem.ts';
import { EffectsManager } from './weather-effects.ts';
import {
    FRONT_ANNOUNCEMENTS,
    FRONT_CLEAR,
    FRONT_RAIN,
    FRONT_STORM,
    createWeatherFrontSample,
    musicDrive,
    resolveWeatherTarget,
    sampleWeatherFront,
    type WeatherTarget,
} from './weather-fronts-core.ts';

// Scratch objects for optimization
const _scratchCelestialState = { sunIntensity: 0, moonIntensity: 0 };
// Sky-light inputs for the atmosphere manager: sun height from the season calendar, moon from game time.
const _scratchSkyLight = { sunInclination: 1, moonPhase: 0 };

// Weather keeps running before the audio system has produced a frame: fronts
// follow the wall clock, so the sky shouldn't wait for music.
const SILENT_AUDIO: VisualState = {
    beatPhase: 0,
    kickTrigger: 0,
    grooveAmount: 0,
    activeChannels: 0,
    channelData: [],
    bpm: 120,
    patternIndex: 0,
    row: 0,
};

const FRONT_TO_STATE: readonly WeatherState[] = [WeatherState.CLEAR, WeatherState.RAIN, WeatherState.STORM];

function stateToFront(state: WeatherState): number {
    return state === WeatherState.STORM ? FRONT_STORM : state === WeatherState.RAIN ? FRONT_RAIN : FRONT_CLEAR;
}

// Music-reactive weather constants
const THUNDER_PULSE_THRESHOLD = 0.75;  // WeatherMusicTargets.thunderPulse value that triggers a storm charge boost
const THUNDER_STORM_CHARGE_BOOST = 0.05; // Storm charge increment per frame when thunder pulse fires

export class WeatherSystem {
    // Core references
    scene: THREE.Scene;

    // State
    state: WeatherState;
    intensity: number;
    stormCharge: number;
    lastState: WeatherState;
    currentLightLevel: number;
    weatherType: string;
    darknessFactor: number;
    targetPaletteMode: string | null;
    currentSeason: SeasonName;
    /** Live state from the season controller, set each frame before update(). */
    seasonState: Readonly<SeasonState> | null;
    /** Last frame's cycle position (s) and moon phase, for save metadata. */
    cyclePos = 0;
    moonPhase = 0;

    // Fronts (weather-fronts-core.ts) own the state; setWeather() overrides them.
    private frontSample = createWeatherFrontSample();
    private weatherTarget: WeatherTarget = { type: FRONT_CLEAR, intensity: 0 };
    private overrideFront = -1;
    private overrideIntensity = 0;
    private lastFrontPhase = -1;
    // Bass and groove smoothed over about a second: weather follows the track's
    // energy, not each kick (kickTrigger drops to 0 between beats).
    private musicBass = 0;
    private musicGroove = 0;

    // Player Control Factor
    cloudDensity: number;
    cloudRegenRate: number;

    // Ground Water Logic
    groundWaterLevel: number;
    trackedCaves: any[];

    // Managers
    private ecosystemManager: EcosystemManager;
    private atmosphereManager: AtmosphereManager;
    private effectsManager: EffectsManager;
    private renderer: any;

    // Tracked entities
    trackedTrees: any[];
    trackedShrubs: any[];
    trackedFlowers: any[];
    trackedMushrooms: any[];
    mushroomPool: any[]; // Object pool for weather mushrooms

    // Particle systems (delegated to EffectsManager but exposed for compatibility)
    mushroomWaterfalls: Set<string>;

    // Lightning (delegated to EffectsManager)
    lightningLight: THREE.PointLight;
    lightningTimer: number;
    lightningActive: boolean;

    // Visual effects (delegated to EffectsManager)
    rainbow: any; // Mesh
    aurora: any; // Mesh
    rainbowTimer: number;

    // Weather transitions
    targetIntensity: number;
    transitionSpeed: number;

    // Wind
    windDirection: THREE.Vector3;
    windSpeed: number;
    windTargetSpeed: number;

    // Spawn handling
    onSpawnFoliage: ((object: any, isNew: boolean, duration: number) => void) | null;
    private lastPatternIndex: number;

    // Fog
    fog: THREE.Fog | THREE.FogExp2 | null;
    baseFogNear: number;
    baseFogFar: number;

    // Twilight calculation helpers
    lastTwilightProgress: number;

    // Particle meshes (exposed for compatibility)
    rainMesh: THREE.Points | null = null;
    mistMesh: THREE.Points | null = null;

    // Internal particle systems reference
    percussionRain: any;
    melodicMist: any;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.state = WeatherState.CLEAR;
        this.intensity = 0;
        this.stormCharge = 0;

        // Player Control Factor
        this.cloudDensity = 1.0;
        this.cloudRegenRate = 0.0005;

        // Ground Water Logic
        this.groundWaterLevel = 0.0;
        this.trackedCaves = [];

        // Initialize managers
        this.ecosystemManager = new EcosystemManager(this);
        this.atmosphereManager = new AtmosphereManager(this);
        this.effectsManager = new EffectsManager(scene);

        this.mushroomWaterfalls = new Set();

        // Initialize effects
        const effectsState = this.effectsManager.getState();
        this.lightningLight = effectsState.lightningLight;
        this.lightningTimer = effectsState.lightningTimer;
        this.lightningActive = effectsState.lightningActive;
        this.rainbow = effectsState.rainbow;
        this.aurora = effectsState.aurora;
        this.rainbowTimer = effectsState.rainbowTimer;

        this.effectsManager.initLightning();
        this.effectsManager.initRainbow();
        this.effectsManager.initAurora();

        this.lastState = WeatherState.CLEAR;

        this.trackedTrees = [];
        this.trackedShrubs = [];
        this.trackedFlowers = [];
        this.trackedMushrooms = [];
        this.mushroomPool = [];

        this.targetIntensity = 0;
        this.transitionSpeed = 0.02;

        this.windDirection = new THREE.Vector3(1, 0, 0.3).normalize();
        this.windSpeed = 0;
        this.windTargetSpeed = 0;
        this.onSpawnFoliage = null;

        this.lastPatternIndex = -1;

        this.fog = scene.fog as THREE.Fog | null;
        this.baseFogNear = (scene.fog as THREE.Fog) ? (scene.fog as THREE.Fog).near : 20;
        this.baseFogFar = (scene.fog as THREE.Fog) ? (scene.fog as THREE.Fog).far : 100;

        this.lastTwilightProgress = 0;
        this.currentSeason = 'spring';
        this.seasonState = null;
        this.currentLightLevel = 0;
        this.weatherType = 'audio';
        this.darknessFactor = 0;
        this.targetPaletteMode = 'standard';
    }

    /**
     * Set renderer for particle systems
     */
    setRenderer(renderer: any): void {
        this.renderer = renderer;
        this.effectsManager.setRenderer(renderer);

        // Sync mesh references
        const effectsState = this.effectsManager.getState();
        this.rainMesh = effectsState.rainMesh;
        this.mistMesh = effectsState.mistMesh;
        this.percussionRain = effectsState.percussionRain;
        this.melodicMist = effectsState.melodicMist;
    }

    /**
     * Register a mushroom for tracking
     */
    registerMushroom(mushroom: any): void {
        if (!mushroom) return;
        if (!this.trackedMushrooms.includes(mushroom)) this.trackedMushrooms.push(mushroom);
    }

    /**
     * Register a cave for tracking
     */
    registerCave(cave: any): void {
        if (!this.trackedCaves.includes(cave)) {
            this.trackedCaves.push(cave);
        }
    }

    /**
     * Unregister a cave from tracking
     */
    unregisterCave(cave: any): void {
        const index = this.trackedCaves.indexOf(cave);
        if (index > -1) {
            this.trackedCaves.splice(index, 1);
        }
    }

    /**
     * Register a tree for tracking
     */
    registerTree(tree: any): void {
        this.trackedTrees.push(tree);
    }

    /**
     * Register a shrub for tracking
     */
    registerShrub(shrub: any): void {
        this.trackedShrubs.push(shrub);
    }

    /**
     * Register a flower for tracking
     */
    registerFlower(flower: any): void {
        this.trackedFlowers.push(flower);
    }

    /**
     * Notify that a cloud was shot
     */
    notifyCloudShot(isDaytime: boolean): void {
        this.cloudDensity = Math.max(0.2, this.cloudDensity - 0.05);
    }

    /**
     * Main update loop - orchestrates all weather systems
     */
    /** Season controller state for this frame (systems/season-controller.ts). */
    setSeasonState(state: Readonly<SeasonState>): void {
        this.seasonState = state;
    }

    update(time: number, audioState: VisualState | null, dt: number = 1 / 60): void {
        const hasAudio = audioState !== null;
        const audioData = audioState ?? SILENT_AUDIO;
        // Per-frame constants below were tuned at 60 fps.
        const frames = dt * 60;

        this.cloudDensity = Math.min(1.0, this.cloudDensity + this.cloudRegenRate);

        // ECOSYSTEM UPDATE
        this.ecosystemManager.updateEcosystem(dt);

        const bassIntensity = audioData.kickTrigger || 0;
        const groove = audioData.grooveAmount || 0;
        const channels = audioData.channelData || [];
        const melodyVol = (channels[2] as any)?.volume || 0;

        const celestial = Cycle.getCelestialState(time, _scratchCelestialState);
        const season = this.seasonState;
        _scratchSkyLight.sunInclination = season ? season.sunInclination : 1;
        _scratchSkyLight.moonPhase = Cycle.getMoonPhase(time);
        if (season) this.currentSeason = SEASON_NAMES[season.current];

        const currentPattern = audioData.patternIndex || 0;

        // Pattern-Change Seasons Logic
        this.handlePatternChange(currentPattern);

        const cyclePos = Cycle.getCyclePos(time);
        this.cyclePos = cyclePos;
        this.moonPhase = _scratchSkyLight.moonPhase;
        // AudioSystem.update() returns a frame even with nothing playing, so
        // "has audio" means something is audible this frame.
        let audible = bassIntensity > 0;
        for (let i = 0; i < channels.length && !audible; i++) {
            if (((channels[i] as { volume?: number } | undefined)?.volume ?? 0) > 0.01) audible = true;
        }
        const smoothing = 1 - Math.exp(-dt * 1.5);
        this.musicBass += (bassIntensity - this.musicBass) * smoothing;
        this.musicGroove += (groove - this.musicGroove) * smoothing;
        this.updateFrontState(this.musicBass, this.musicGroove, hasAudio && audible, cyclePos);

        // Ground Water Update
        this.updateGroundWater(frames);

        // Update Caves
        if (this.trackedCaves.length > 0) {
            for (let i = 0; i < this.trackedCaves.length; i++) {
                updateCaveWaterLevel(this.trackedCaves[i], this.groundWaterLevel);
            }
        }

        // Twilight Glow Update
        const twilightIntensity = this.atmosphereManager.getTwilightGlowIntensity(cyclePos);
        this.lastTwilightProgress = twilightIntensity;
        try { if (uTwilight) uTwilight.value = twilightIntensity; } catch (e) { void e; }

        // Aurora Update
        this.effectsManager.updateAurora(twilightIntensity, this.state);

        // Rainbow Update
        this.rainbowTimer = this.effectsManager.updateRainbow(dt, this.lastState, this.state, this.rainbowTimer);
        this.lastState = this.state;

        // Light level and cloud density
        this.currentLightLevel = this.atmosphereManager.getGlobalLightLevel(celestial, _scratchSkyLight);
        this.targetIntensity *= this.cloudDensity;

        const highVol = (channels[3] as any)?.volume || 0;

        // Cloud rainbow intensity
        this.effectsManager.updateCloudRainbow(melodyVol, highVol, this.cloudDensity);

        // Cloud lightning
        this.lightningActive = this.effectsManager.updateCloudLightning(
            this.state,
            this.intensity,
            bassIntensity,
            this.cloudDensity,
            this.lightningLight
        );

        // Darkness logic
        this.atmosphereManager.applyDarknessLogic(celestial, _scratchSkyLight.moonPhase);

        // Calculate favorability scores
        const sunPower = celestial.sunIntensity * (1.0 - this.cloudDensity * 0.7);
        const moonPower = celestial.moonIntensity * 0.3;
        const globalLight = Math.max(0, sunPower + moonPower);
        const moisture = this.intensity + (this.stormCharge * 0.5);

        let floraFavorability = globalLight * (0.5 + moisture);
        if (moisture > 0.9) floraFavorability *= 0.5;

        const fungiFavorability = (1.0 - globalLight) * (0.2 + moisture * 1.5);
        const lanternFavorability = (this.state === WeatherState.STORM ? 1.0 : 0.0) + (1.0 - globalLight) * 0.2;

        // Plant growth from rain
        if (this.percussionRain && this.rainMesh && this.rainMesh.visible) {
            if (this.trackedTrees.length > 0) {
                triggerGrowth(this.trackedTrees, floraFavorability * bassIntensity * 0.1);
            }
            if (this.trackedFlowers.length > 0) {
                triggerGrowth(this.trackedFlowers, floraFavorability * bassIntensity * 0.1);
            }
        }

        // Mushroom growth/shrink logic
        this.updateMushroomGrowth(bassIntensity, globalLight);

        // Spawning
        const isRaining = this.state === WeatherState.RAIN || this.state === WeatherState.STORM;
        this.ecosystemManager.handleSpawning(time, fungiFavorability, lanternFavorability, globalLight, this.onSpawnFoliage, isRaining);

        // Waterfalls
        this.ecosystemManager.updateMushroomWaterfalls(time, bassIntensity, this.state, this.intensity, this.trackedMushrooms, this.mushroomWaterfalls);

        // Update BerryBatcher
        BerryBatcher.getInstance().update(time, audioData);

        // Intensity transition: transitionSpeed per 60 fps frame, frame-rate independent.
        this.intensity +=
            (this.targetIntensity - this.intensity) * (1 - Math.pow(1 - this.transitionSpeed, frames));

        // --- Music-driven weather blend ---
        // When enabled, lerp base intensity and fog toward music channel targets.
        // Guard: when disabled, behaviour is byte-for-byte identical to before.
        let musicFogIntensity = this.intensity;
        if (CONFIG.weather.musicReactivity.enabled) {
            const w = CONFIG.weather.musicReactivity.blendWeight;
            const range = CONFIG.season.weather.musicIntensityRange;
            const baseIntensity = this.intensity; // capture before rain blend
            // Music nudges a front, it doesn't replace it: same ±range as the front's music drive.
            this.intensity = THREE.MathUtils.clamp(
                THREE.MathUtils.lerp(baseIntensity, WeatherMusicTargets.rainIntensity, w),
                Math.max(0, baseIntensity - range),
                Math.min(1, baseIntensity + range)
            );
            musicFogIntensity = THREE.MathUtils.clamp(
                THREE.MathUtils.lerp(baseIntensity, WeatherMusicTargets.fogDensity, w),
                0, 1
            );
            // thunderPulse: threshold trigger — boost storm charge for a dramatic flash
            if (WeatherMusicTargets.thunderPulse > THUNDER_PULSE_THRESHOLD) {
                this.stormCharge = Math.min(2.0, this.stormCharge + THUNDER_STORM_CHARGE_BOOST * frames);
            }
        }

        // Particle systems
        this.effectsManager.updateParticleSystems(this.renderer, dt, bassIntensity, melodyVol, this.weatherType, this.state);

        // Storm-specific effects
        if (this.state === WeatherState.STORM) {
            const lightningResult = this.atmosphereManager.updateLightning(
                time,
                bassIntensity,
                this.lightningTimer,
                this.lightningActive,
                this.lightningLight
            );
            this.lightningTimer = lightningResult.lightningTimer;
            this.lightningActive = lightningResult.lightningActive;

            this.atmosphereManager.chargeBerryGlow(bassIntensity, this.trackedTrees, this.trackedShrubs);
        }

        // Storm charge accumulation
        if (this.state !== WeatherState.CLEAR) {
            this.stormCharge = Math.min(2.0, this.stormCharge + 0.001 * frames);
        } else {
            this.stormCharge = Math.max(0, this.stormCharge - 0.0005 * frames);
        }

        // Wind update
        const windResult = this.atmosphereManager.updateWind(
            time,
            audioData,
            celestial,
            this.windDirection,
            this.windSpeed,
            this.windTargetSpeed,
            this.trackedMushrooms
        );
        this.windDirection = windResult.windDirection;
        this.windSpeed = windResult.windSpeed;
        this.windTargetSpeed = windResult.windTargetSpeed;

        // Wind-based mushroom spawning
        this.ecosystemManager.handleWindSpawning(
            time,
            this.windSpeed,
            this.windDirection,
            this.trackedMushrooms,
            this.mushroomPool,
            this.onSpawnFoliage,
            this.scene
        );

        // Fog update — base distances derived from camera + day/night; weather applies modifiers
        if (camera) {
            const fogTargets = computeAtmosphereFogTargets(
                camera,
                camera.position.y,
                getDayNightBias(cyclePos),
            );
            this.baseFogNear = fogTargets.near;
            this.baseFogFar = fogTargets.far;
        }

        this.atmosphereManager.updateFog(
            audioData,
            this.state,
            musicFogIntensity,
            this.darknessFactor,
            this.baseFogNear,
            this.baseFogFar,
            this.weatherType,
            this.fog,
            dt,
        );
    }

    private handlePatternChange(currentPattern: number): void {
        if (currentPattern !== this.lastPatternIndex) {
            this.lastPatternIndex = currentPattern;

            let nextMode = 'standard';

            if (currentPattern >= 4 && currentPattern <= 7) nextMode = 'neon';
            else if (currentPattern >= 8 && currentPattern <= 11) nextMode = 'glitch';

            if (nextMode !== this.targetPaletteMode) {
                this.targetPaletteMode = nextMode;
                console.log(`[Weather] Season Changed: Pattern ${currentPattern} -> Mode ${nextMode}`);

                this.effectsManager.triggerPalettePulse();
            }
        }
    }

    private updateGroundWater(frames: number): void {
        if (this.state === WeatherState.RAIN) {
            this.groundWaterLevel = Math.min(1.0, this.groundWaterLevel + 0.0005 * frames);
        } else if (this.state === WeatherState.STORM) {
            this.groundWaterLevel = Math.min(1.0, this.groundWaterLevel + 0.0015 * frames);
        } else {
            this.groundWaterLevel = Math.max(0.0, this.groundWaterLevel - 0.0003 * frames);
        }
    }

    private updateMushroomGrowth(bassIntensity: number, globalLight: number): void {
        let mushroomRate = 0;
        const isRaining = this.state === WeatherState.RAIN || this.state === WeatherState.STORM;

        if (isRaining) {
            // Grow: Base rate + bass boost
            mushroomRate = 0.5 + (bassIntensity * 0.5);
        } else {
            if (globalLight > 0.6 && this.cloudDensity < 0.5) {
                // Bright Sun + Dry: Shrink
                mushroomRate = -0.5;
            } else {
                // Night or Cloudy: Neutral / slight decay
                mushroomRate = -0.05;
            }
        }

        if (this.trackedMushrooms.length > 0) {
            // Trigger with calculated rate (can be negative)
            triggerGrowth(this.trackedMushrooms, mushroomRate);
        }
    }

    /**
     * Fronts decide clear / rain / storm (weather-fronts-core.ts); music only
     * nudges intensity; setWeather() overrides both.
     */
    private updateFrontState(bass: number, groove: number, hasAudio: boolean, cyclePos: number): void {
        const season = this.seasonState;
        const front = this.frontSample;
        if (season) {
            sampleWeatherFront(
                season.nowMs,
                season.seed,
                CONFIG.season,
                CONFIG.season.weather,
                season.pinned,
                front
            );
        } else {
            front.type = FRONT_CLEAR;
            front.intensity = 0;
            front.phase = 0;
            front.ramp = 1;
        }

        const target = resolveWeatherTarget(
            this.overrideFront,
            this.overrideIntensity,
            front,
            musicDrive(bass, groove, hasAudio),
            CONFIG.season.weather.musicIntensityRange,
            this.weatherTarget
        );
        this.state = FRONT_TO_STATE[target.type];
        this.targetIntensity = target.intensity;
        this.weatherType =
            this.state === WeatherState.RAIN
                ? rainFlavour(cyclePos)
                : this.state === WeatherState.STORM
                  ? 'thunderstorm'
                  : 'clear';

        if (this.overrideFront < 0 && front.phase !== this.lastFrontPhase) {
            // The phase a session boots into is not news.
            const message = this.lastFrontPhase === -1 ? null : FRONT_ANNOUNCEMENTS[front.phase];
            if (message) announce(message, 'polite');
            this.lastFrontPhase = front.phase;
        }
    }

    /**
     * Legacy compatibility methods delegated to ecosystem manager
     */
    transformMushroom(oldMushroom: any): void {
        this.ecosystemManager.transformMushroom(oldMushroom);
    }

    manageMushroomCount(): void {
        this.ecosystemManager.manageMushroomCount();
    }

    spawnFoliage(type: string, isGlowing: boolean): void {
        this.ecosystemManager.spawnFoliage(type, isGlowing, this.onSpawnFoliage);
    }

    handleSpawning(time: number, fungiScore: number, lanternScore: number, globalLight: number): void {
        const isRaining = this.state === WeatherState.RAIN || this.state === WeatherState.STORM;
        this.ecosystemManager.handleSpawning(time, fungiScore, lanternScore, globalLight, this.onSpawnFoliage, isRaining);
    }

    updateMushroomWaterfalls(time: number, bassIntensity: number): void {
        this.ecosystemManager.updateMushroomWaterfalls(time, bassIntensity, this.state, this.intensity, this.trackedMushrooms, this.mushroomWaterfalls);
    }

    /**
     * Legacy compatibility methods delegated to atmosphere manager
     */
    getGlobalLightLevel(celestial: any, seasonal: any): number {
        return this.atmosphereManager.getGlobalLightLevel(celestial, seasonal);
    }

    getTwilightGlowIntensity(cyclePos: number): number {
        return this.atmosphereManager.getTwilightGlowIntensity(cyclePos);
    }

    isNight(): boolean {
        return this.atmosphereManager.isNight(this.lastTwilightProgress);
    }

    applyDarknessLogic(celestial: any, moonPhase: number): void {
        this.atmosphereManager.applyDarknessLogic(celestial, moonPhase);
    }

    updateFog(audioData: VisualState): void {
        if (camera) {
            const cyclePos = (audioData as any)?.time ? (audioData as any).time % CYCLE_DURATION : 0;
            const fogTargets = computeAtmosphereFogTargets(
                camera,
                camera.position.y,
                getDayNightBias(cyclePos),
            );
            this.baseFogNear = fogTargets.near;
            this.baseFogFar = fogTargets.far;
        }
        this.atmosphereManager.updateFog(
            audioData,
            this.state,
            this.intensity,
            this.darknessFactor,
            this.baseFogNear,
            this.baseFogFar,
            this.weatherType,
            this.fog,
            0.016,
        );
    }

    updateBerrySeasonalSize(cyclePos: number): void {
        this.atmosphereManager.updateBerrySeasonalSize(cyclePos);
    }

    updateWind(time: number, audioData: VisualState, celestial: any): void {
        const windResult = this.atmosphereManager.updateWind(
            time,
            audioData,
            celestial,
            this.windDirection,
            this.windSpeed,
            this.windTargetSpeed,
            this.trackedMushrooms
        );
        this.windDirection = windResult.windDirection;
        this.windSpeed = windResult.windSpeed;
        this.windTargetSpeed = windResult.windTargetSpeed;
    }

    updateLightning(time: number, bassIntensity: number): void {
        const result = this.atmosphereManager.updateLightning(
            time,
            bassIntensity,
            this.lightningTimer,
            this.lightningActive,
            this.lightningLight
        );
        this.lightningTimer = result.lightningTimer;
        this.lightningActive = result.lightningActive;
    }

    chargeBerryGlow(bassIntensity: number): void {
        this.atmosphereManager.chargeBerryGlow(bassIntensity, this.trackedTrees, this.trackedShrubs);
    }

    /**
     * Legacy compatibility methods delegated to effects manager
     */
    initRainbow(): void {
        this.effectsManager.initRainbow();
        this.rainbow = this.effectsManager.getState().rainbow;
    }

    initAurora(): void {
        this.effectsManager.initAurora();
        this.aurora = this.effectsManager.getState().aurora;
    }

    initLightning(): void {
        this.effectsManager.initLightning();
        const effectsState = this.effectsManager.getState();
        this.lightningLight = effectsState.lightningLight;
        this.lightningTimer = effectsState.lightningTimer;
        this.lightningActive = effectsState.lightningActive;
    }

    initParticles(): void {
        // Obsolete, use setRenderer
    }

    growPlants(intensity: number): void {
        this.effectsManager.growPlants(this.trackedTrees, this.trackedMushrooms, intensity);
    }

    bloomFlora(intensity: number): void {
        this.effectsManager.bloomFlora(this.trackedFlowers, intensity);
    }

    /**
     * State management API
     */
    getState(): WeatherState {
        return this.state;
    }

    getStormCharge(): number {
        return this.stormCharge;
    }

    getIntensity(): number {
        return this.intensity;
    }

    /**
     * Pin the weather (debug, visual regression) until called with null, which
     * hands control back to the fronts. Intensity snaps so a capture doesn't
     * wait out the ease.
     */
    setWeather(state: WeatherState | 'clear' | 'rain' | 'storm' | null, intensity?: number): void {
        if (state === null) {
            this.overrideFront = -1;
            return;
        }
        const front = stateToFront(state as WeatherState);
        this.overrideFront = front;
        this.overrideIntensity = front === FRONT_CLEAR ? 0 : (intensity ?? (front === FRONT_STORM ? 1.0 : 0.5));
        this.state = FRONT_TO_STATE[front];
        this.targetIntensity = this.overrideIntensity;
        this.intensity = this.overrideIntensity;
    }

    forceState(state: WeatherState): void {
        this.setWeather(state);
    }

    /**
     * Cleanup
     */
    dispose(): void {
        this.effectsManager.dispose();

        // Cleanup any remaining waterfalls
        if (this.mushroomWaterfalls && this.mushroomWaterfalls.size > 0) {
            for (const uuid of this.mushroomWaterfalls) {
                waterfallBatcher.remove(uuid);
            }
            this.mushroomWaterfalls.clear();
        }
    }
}
