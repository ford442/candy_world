// src/systems/weather/weather.ts
// Core WeatherSystem orchestrator - delegates to specialized managers

import * as THREE from 'three';
import { WeatherState } from '../weather-types.ts';
import { calculateTimeOfDayBias } from '../weather-utils.ts';
import { EcosystemManager } from './weather-ecosystem.ts';
import { AtmosphereManager } from './weather-atmosphere.ts';
import { EffectsManager } from './weather-effects.ts';
import { CYCLE_DURATION, DURATION_SUNRISE, DURATION_DAY } from '../../core/config.ts';
import * as Cycle from '../../core/cycle.ts';
import { VisualState } from '../../audio/audio-system.ts';

import { uTwilight } from '../../foliage/sky.ts';
import { updateCaveWaterLevel } from '../../foliage/cave.ts';
import { berryBatcher } from '../../foliage/berries.ts';
import { triggerGrowth } from '../../foliage/animation.ts';
import { waterfallBatcher } from '../../foliage/waterfall-batcher.ts';

// Scratch objects for optimization
const _scratchCelestialState = { sunIntensity: 0, moonIntensity: 0 };
const _scratchSeasonalState: Cycle.SeasonalState = { season: 'Spring', sunInclination: 0, moonPhase: 0, yearProgress: 0 };

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
    currentSeason: string;
    
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
        this.currentSeason = 'Spring';
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
    update(time: number, audioData: VisualState | null): void {
        if (!audioData) return;
        const dt = 0.016;

        this.cloudDensity = Math.min(1.0, this.cloudDensity + this.cloudRegenRate);

        // ECOSYSTEM UPDATE
        this.ecosystemManager.updateEcosystem(dt);

        const bassIntensity = audioData.kickTrigger || 0;
        const groove = audioData.grooveAmount || 0;
        const channels = audioData.channelData || [];
        const melodyVol = (channels[2] as any)?.volume || 0;

        const celestial = Cycle.getCelestialState(time, _scratchCelestialState);
        const seasonal = Cycle.getSeasonalState(time, _scratchSeasonalState);

        this.currentSeason = seasonal.season;

        const currentPattern = audioData.patternIndex || 0;

        // Pattern-Change Seasons Logic
        this.handlePatternChange(currentPattern);

        const cyclePos = time % CYCLE_DURATION;
        const cycleWeatherBias = calculateTimeOfDayBias(cyclePos);
        this.updateWeatherState(bassIntensity, melodyVol, groove, cycleWeatherBias, seasonal);

        // Ground Water Update
        this.updateGroundWater();

        // Update Caves
        if (this.trackedCaves.length > 0) {
            for (let i = 0; i < this.trackedCaves.length; i++) {
                updateCaveWaterLevel(this.trackedCaves[i], this.groundWaterLevel);
            }
        }

        // Twilight Glow Update
        const twilightIntensity = this.atmosphereManager.getTwilightGlowIntensity(cyclePos);
        this.lastTwilightProgress = twilightIntensity;
        try { if (uTwilight) uTwilight.value = twilightIntensity; } catch (e) {}

        // Aurora Update
        this.effectsManager.updateAurora(twilightIntensity, this.state);

        // Rainbow Update
        this.rainbowTimer = this.effectsManager.updateRainbow(dt, this.lastState, this.state, this.rainbowTimer);
        this.lastState = this.state;

        // Light level and cloud density
        this.currentLightLevel = this.atmosphereManager.getGlobalLightLevel(celestial, seasonal);
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
        this.atmosphereManager.applyDarknessLogic(celestial, seasonal.moonPhase);

        // Calculate favorability scores
        const sunPower = celestial.sunIntensity * (1.0 - this.cloudDensity * 0.7);
        const moonPower = celestial.moonIntensity * 0.3;
        const globalLight = Math.max(0, sunPower + moonPower);
        const moisture = this.intensity + (this.stormCharge * 0.5);

        let floraFavorability = globalLight * (0.5 + moisture);
        if (moisture > 0.9) floraFavorability *= 0.5;

        let fungiFavorability = (1.0 - globalLight) * (0.2 + moisture * 1.5);
        let lanternFavorability = (this.state === WeatherState.STORM ? 1.0 : 0.0) + (1.0 - globalLight) * 0.2;

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
        this.ecosystemManager.handleSpawning(time, fungiFavorability, lanternFavorability, globalLight, this.onSpawnFoliage);
        
        // Waterfalls
        this.ecosystemManager.updateMushroomWaterfalls(time, bassIntensity, this.state, this.intensity, this.trackedMushrooms, this.mushroomWaterfalls);

        // Update BerryBatcher
        berryBatcher.update(time, audioData);

        // Intensity transition
        this.intensity += (this.targetIntensity - this.intensity) * this.transitionSpeed;

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
            this.stormCharge = Math.min(2.0, this.stormCharge + 0.001);
        } else {
            this.stormCharge = Math.max(0, this.stormCharge - 0.0005);
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

        // Fog update
        this.atmosphereManager.updateFog(
            audioData,
            this.state,
            this.intensity,
            this.darknessFactor,
            this.baseFogNear,
            this.baseFogFar,
            this.weatherType,
            this.fog
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

    private updateGroundWater(): void {
        if (this.state === WeatherState.RAIN) {
            this.groundWaterLevel = Math.min(1.0, this.groundWaterLevel + 0.0005);
        } else if (this.state === WeatherState.STORM) {
            this.groundWaterLevel = Math.min(1.0, this.groundWaterLevel + 0.0015);
        } else {
            this.groundWaterLevel = Math.max(0.0, this.groundWaterLevel - 0.0003);
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

    private updateWeatherState(bass: number, melody: number, groove: number, cycleWeatherBias: any = null, seasonal: any = null): void {
        let audioState = WeatherState.CLEAR;
        let audioIntensity = 0;

        if (bass > 0.7 && groove > 0.5) {
            audioState = WeatherState.STORM;
            audioIntensity = 1.0;
        } else if (bass > 0.3 || melody > 0.4) {
            audioState = WeatherState.RAIN;
            audioIntensity = 0.5;
        }

        if (seasonal) {
            const r = Math.random();
            if (seasonal.season === 'Winter') {
                if (audioState === WeatherState.STORM && r > 0.3) audioState = WeatherState.RAIN;
            }
            if (seasonal.season === 'Summer') {
                if (audioState === WeatherState.RAIN && r > 0.7) audioState = WeatherState.STORM;
            }
            if (seasonal.season === 'Spring') {
                if (audioState === WeatherState.CLEAR && r > 0.9) {
                    audioState = WeatherState.RAIN;
                    audioIntensity = 0.3;
                }
            }
        }

        if (cycleWeatherBias) {
            const biasWeight = 0.4;
            let biasState = WeatherState.CLEAR;
            if (cycleWeatherBias.biasState === 'storm') biasState = WeatherState.STORM;
            else if (cycleWeatherBias.biasState === 'rain') biasState = WeatherState.RAIN;

            if (audioState !== biasState) {
                if (Math.random() < biasWeight) { 
                    this.state = biasState; 
                    this.targetIntensity = cycleWeatherBias.biasIntensity; 
                }
                else { 
                    this.state = audioState; 
                    this.targetIntensity = audioIntensity; 
                }
            } else {
                this.state = audioState;
                this.targetIntensity = audioIntensity * (1 - biasWeight) + cycleWeatherBias.biasIntensity * biasWeight;
            }
            this.weatherType = cycleWeatherBias.type || 'default';
        } else {
            this.state = audioState;
            this.targetIntensity = audioIntensity;
            this.weatherType = 'audio';
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
        this.ecosystemManager.handleSpawning(time, fungiScore, lanternScore, globalLight, this.onSpawnFoliage);
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
        this.atmosphereManager.updateFog(
            audioData,
            this.state,
            this.intensity,
            this.darknessFactor,
            this.baseFogNear,
            this.baseFogFar,
            this.weatherType,
            this.fog
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

    forceState(state: WeatherState): void {
        this.state = state;
        switch (state) {
            case WeatherState.STORM: this.targetIntensity = 1.0; break;
            case WeatherState.RAIN: this.targetIntensity = 0.5; break;
            default: this.targetIntensity = 0;
        }
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
