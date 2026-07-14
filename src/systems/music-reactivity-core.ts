import * as THREE from 'three';
import { CONFIG, CYCLE_DURATION } from '../core/config.ts';
import { getDayNightBias } from '../core/cycle.ts';
import { animateFoliage } from '../foliage/animation.ts';
import { foliageBatcher } from '../foliage/batcher/index.ts';
import { arpeggioFernBatcher } from '../foliage/arpeggio-batcher.ts';
import { portamentoPineBatcher } from '../foliage/portamento-batcher.ts';
import { mushroomBatcher } from '../foliage/mushroom-batcher.ts';
import { flowerBatcher } from '../foliage/flower-batcher.ts';
import { simpleFlowerBatcher } from '../foliage/simple-flower-batcher.ts';
import { kickDrumGeyserBatcher } from '../foliage/kick-drum-geyser-batcher.ts';
import { subwooferLotusBatcher } from '../foliage/subwoofer-lotus-batcher.ts';
import type { AudioData, FoliageObject } from '../foliage/types.ts';
import { BiomeUniforms, SkyUniforms, LuminousPlantUniforms } from './biome-uniforms.ts';
import { uTwilight } from '../foliage/sky.ts';
import { BeatSync } from '../audio/beat-sync.ts';
import {
    defaultArpeggioShimmerCh, defaultArpeggioHueShiftCh, defaultArpeggioNoteColorCh,
    defaultNebulaShimmerCh, defaultNebulaAmplitudeCh, defaultNebulaNoteColorCh,
    defaultSkyMoonNoteColorCh, defaultSkyMoonIntensityCh, defaultGlobalShimmerCh,
    defaultGlobalHueShiftCh, defaultGlobalNoteColorCh, defaultSkyMoonMelodyCh,
    defaultLuminousPlantTrackerChannel, defaultGemCanopyShimmerCh, defaultGemCanopyHueShiftCh,
    defaultGemCanopyNoteColorCh, WeatherReactivityBinding, defaultWeatherBindings,
    defaultSkyWavePropagationMs, defaultSkyWaveDecayMs, defaultSkyWaveTargets,
    skyWaveUniformMap, CHROMATIC_SCALE
} from './music-reactivity-defaults.ts';

import { getMapMusicContext } from '../world/map-music-context.ts';
import type { MapMusicOverrides } from '../world/map-loader.ts';
import {
    updateAtmosphereReactivity,
    registerAtmosphereBeatSync,
    applyAtmosphereMapOverrides,
} from './atmosphere-reactivity.ts';
import { awakenedPersistence } from './awakened-persistence.ts';

const _WEATHER_KEYS: Array<'rainIntensity' | 'thunderPulse' | 'fogDensity'> = ['rainIntensity', 'thunderPulse', 'fogDensity'];







// ⚡ OPTIMIZATION: Per-frame scratch floats — no per-frame object allocations.







 // The active MIDI note (e.g., 60 for C4)




// ⚡ OPTIMIZATION: Module-scoped colors for zero-allocation note lerping

export const MRState = {
    arpeggioShimmerCh: defaultArpeggioShimmerCh as readonly number[],
    arpeggioHueShiftCh: defaultArpeggioHueShiftCh as readonly number[],
    arpeggioNoteColorCh: defaultArpeggioNoteColorCh as readonly number[],
    nebulaShimmerCh: defaultNebulaShimmerCh as readonly number[],
    nebulaAmplitudeCh: defaultNebulaAmplitudeCh as readonly number[],
    nebulaNoteColorCh: defaultNebulaNoteColorCh as readonly number[],
    skyMoonNoteColorCh: defaultSkyMoonNoteColorCh as readonly number[],
    skyMoonIntensityCh: defaultSkyMoonIntensityCh as readonly number[],
    globalShimmerCh: defaultGlobalShimmerCh as readonly number[],
    globalHueShiftCh: defaultGlobalHueShiftCh as readonly number[],
    globalNoteColorCh: defaultGlobalNoteColorCh as readonly number[],
    gemCanopyShimmerCh: defaultGemCanopyShimmerCh as readonly number[],
    gemCanopyHueShiftCh: defaultGemCanopyHueShiftCh as readonly number[],
    gemCanopyNoteColorCh: defaultGemCanopyNoteColorCh as readonly number[],
    arpeggioIntensityScale: 1.0,
    nebulaIntensityScale: 1.0,
    globalIntensityScale: 1.0,
    gemCanopyIntensityScale: 1.0,
    skyMoonIntensityScale: 1.0,
    luminousIntensityScale: 1.0,
    arpeggioShimmerAccum: 0.0,
    arpeggioHueShiftAccum: 0.0,
    nebulaShimmerAccum: 0.0,
    nebulaAmplitudeAccum: 0.0,
    skyMoonIntensityAccum: 0.0,
    globalShimmerAccum: 0.0,
    globalHueShiftAccum: 0.0,
    gemCanopyShimmerAccum: 0.0,
    gemCanopyHueShiftAccum: 0.0,
    skyMoonNoteVal: 0.0,
    arpeggioNoteVal: 0.0,
    nebulaNoteVal: 0.0,
    globalNoteVal: 0.0,
    gemCanopyNoteVal: 0.0,
    skyMoonCh: defaultSkyMoonMelodyCh,
    luminousPlantTrackerChannel: defaultLuminousPlantTrackerChannel,
    smoothedSkyIntensity: 0.0,
    lastSkyNoteIndex: 0.0,
    weatherBindings: {
        rainIntensity: defaultWeatherBindings.rainIntensity ? { ...defaultWeatherBindings.rainIntensity } : undefined,
        thunderPulse: defaultWeatherBindings.thunderPulse ? { ...defaultWeatherBindings.thunderPulse } : undefined,
        fogDensity: defaultWeatherBindings.fogDensity ? { ...defaultWeatherBindings.fogDensity } : undefined,
    } as any,
    skyWavePropagationMs: defaultSkyWavePropagationMs,
    skyWaveDecayMs: defaultSkyWaveDecayMs,
    skyWaveTargets: [...defaultSkyWaveTargets] as string[],
    activeWave: null as any,
    waveDecayStartTime: 0,
    channelValidationDone: false,
    appliedMapMusicVersion: -1,
};

export const _targetMoonColor = new THREE.Color(0xffffff);
export const _targetArpeggioColor = new THREE.Color(0xffffff);
export const _targetNebulaColor = new THREE.Color(0xffffff);
export const _targetGlobalColor = new THREE.Color(0xffffff);
export const _targetGemCanopyColor = new THREE.Color(0xffffff);

// ⚡ OPTIMIZATION: Sky/Moon note reactivity scratch — allocated once, never in hot path.
// melody_channel from assets/music-bindings.json sky_moon block.



// Last valid note index (0–127) kept across frames to avoid flicker when channel is silent.


// ⚡ OPTIMIZATION: Reusable Frustum & Matrices
export const _frustum = new THREE.Frustum();
export const _projScreenMatrix = new THREE.Matrix4();
export const _scratchSphere = new THREE.Sphere(); // Reusable for Group culling checks

// ⚡ OPTIMIZATION: Reusable scratch array for species list
const _scratchSpeciesList: string[] = [];

// --- Weather Music Reactivity ---
// Parsed once at module init from assets/music-bindings.json weatherReactivity block.

// ⚡ SKY WAVE config from music-bindings.json




// Map from sky_wave.target_biomes keys (in music-bindings.json) → the Color uniform to receive the propagating hue.
// This makes the wave fully data-driven. Adding a new target = add key here + entry in JSON list.
// Many foliage already consume arpeggioGrove.noteColor or crystallineNebula.noteColor (portamento, wisteria, trees, mushrooms),
// so they receive the sky wave "for free" when those hubs are targeted.


// ⚡ SKY WAVE state — pre-allocated, zero per-frame allocations in hot path
export interface ActiveWave { color: THREE.Color; timestamp: number; origin?: THREE.Vector3; speed?: number; }


export const _zeroVec = new THREE.Vector3();
export function computeWaveTimeSinceArrival(plantWorldPos: THREE.Vector3, activeWave: ActiveWave | null, cameraPosition?: THREE.Vector3): number {
    if (!activeWave) return -999;
    const origin = activeWave.origin || cameraPosition || _zeroVec;
    const speed = activeWave.speed || 25.0;
    // ⚡ OPTIMIZATION: Bypassed THREE.Vector3.distanceTo() overhead in hot loop with raw math.
    const dx = plantWorldPos.x - origin.x;
    const dy = plantWorldPos.y - origin.y;
    const dz = plantWorldPos.z - origin.z;

    // Reverted: Using Math.sqrt() because we actually need linear arrival distance for timing logic.
    // The previous optimization attempt distorted wave propagation.
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const arrivalTime = activeWave.timestamp + (distance / speed) * 1000;
    return (performance.now() - arrivalTime) / 1000;
}
export const _waveColor = new THREE.Color(); // scratch for beat capture
export const _whiteColor = new THREE.Color(0xffffff);


// One-time validation flag for channel range checks against music-bindings.json



export function toChannels(value: unknown): readonly number[] | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const sanitized: number[] = [];
    for (let i = 0; i < value.length; i++) {
        const channel = value[i];
        if (Number.isInteger(channel) && channel >= 0 && channel <= 255) sanitized.push(channel as number);
    }
    return sanitized.length > 0 ? sanitized : undefined;
}

export function applyMapMusicContext(overrides: MapMusicOverrides | undefined): void {
    MRState.arpeggioShimmerCh = defaultArpeggioShimmerCh;
    MRState.arpeggioHueShiftCh = defaultArpeggioHueShiftCh;
    MRState.arpeggioNoteColorCh = defaultArpeggioNoteColorCh;
    MRState.nebulaShimmerCh = defaultNebulaShimmerCh;
    MRState.nebulaAmplitudeCh = defaultNebulaAmplitudeCh;
    MRState.nebulaNoteColorCh = defaultNebulaNoteColorCh;
    MRState.skyMoonNoteColorCh = defaultSkyMoonNoteColorCh;
    MRState.skyMoonIntensityCh = defaultSkyMoonIntensityCh;
    MRState.globalShimmerCh = defaultGlobalShimmerCh;
    MRState.globalHueShiftCh = defaultGlobalHueShiftCh;
    MRState.globalNoteColorCh = defaultGlobalNoteColorCh;
    MRState.gemCanopyShimmerCh = defaultGemCanopyShimmerCh;
    MRState.gemCanopyHueShiftCh = defaultGemCanopyHueShiftCh;
    MRState.gemCanopyNoteColorCh = defaultGemCanopyNoteColorCh;

    MRState.arpeggioIntensityScale = 1.0;
    MRState.nebulaIntensityScale = 1.0;
    MRState.globalIntensityScale = 1.0;
    MRState.gemCanopyIntensityScale = 1.0;
    MRState.skyMoonIntensityScale = 1.0;
    MRState.luminousIntensityScale = 1.0;

    MRState.skyMoonCh = defaultSkyMoonMelodyCh;
    MRState.luminousPlantTrackerChannel = defaultLuminousPlantTrackerChannel;

    MRState.weatherBindings = {
        rainIntensity: defaultWeatherBindings.rainIntensity ? { ...defaultWeatherBindings.rainIntensity } : undefined,
        thunderPulse: defaultWeatherBindings.thunderPulse ? { ...defaultWeatherBindings.thunderPulse } : undefined,
        fogDensity: defaultWeatherBindings.fogDensity ? { ...defaultWeatherBindings.fogDensity } : undefined,
    };
    MRState.skyWavePropagationMs = defaultSkyWavePropagationMs;
    MRState.skyWaveDecayMs = defaultSkyWaveDecayMs;
    MRState.skyWaveTargets.length = 0;
    for (let i = 0; i < defaultSkyWaveTargets.length; i++) {
        MRState.skyWaveTargets.push(defaultSkyWaveTargets[i]);
    }

    const biomeOverrides = overrides?.biomes;
    if (biomeOverrides && typeof biomeOverrides === 'object') {
        const arpeggio = biomeOverrides.arpeggio_grove;
        const nebula = biomeOverrides.crystalline_nebula;
        const skyMoon = biomeOverrides.sky_moon;
        const global = biomeOverrides.global;
        const gemCanopy = biomeOverrides.gem_canopy;
        if (arpeggio) {
            MRState.arpeggioShimmerCh = toChannels(arpeggio.shimmer) ?? MRState.arpeggioShimmerCh;
            MRState.arpeggioHueShiftCh = toChannels(arpeggio.hueShift) ?? MRState.arpeggioHueShiftCh;
            MRState.arpeggioNoteColorCh = toChannels(arpeggio.noteColor) ?? MRState.arpeggioNoteColorCh;
            if (typeof arpeggio.intensityScale === 'number' && Number.isFinite(arpeggio.intensityScale)) {
                MRState.arpeggioIntensityScale = arpeggio.intensityScale;
            }
        }
        if (nebula) {
            MRState.nebulaShimmerCh = toChannels(nebula.shimmer) ?? MRState.nebulaShimmerCh;
            MRState.nebulaAmplitudeCh = toChannels(nebula.amplitudeScale) ?? MRState.nebulaAmplitudeCh;
            MRState.nebulaNoteColorCh = toChannels(nebula.noteColor) ?? MRState.nebulaNoteColorCh;
            if (typeof nebula.intensityScale === 'number' && Number.isFinite(nebula.intensityScale)) {
                MRState.nebulaIntensityScale = nebula.intensityScale;
            }
        }
        if (skyMoon) {
            MRState.skyMoonNoteColorCh = toChannels(skyMoon.noteColor) ?? MRState.skyMoonNoteColorCh;
            MRState.skyMoonIntensityCh = toChannels(skyMoon.intensity) ?? MRState.skyMoonIntensityCh;
            if (typeof skyMoon.intensityScale === 'number' && Number.isFinite(skyMoon.intensityScale)) {
                MRState.skyMoonIntensityScale = skyMoon.intensityScale;
            }
        }
        if (global) {
            MRState.globalShimmerCh = toChannels(global.shimmer) ?? MRState.globalShimmerCh;
            MRState.globalHueShiftCh = toChannels(global.hueShift) ?? MRState.globalHueShiftCh;
            MRState.globalNoteColorCh = toChannels(global.noteColor) ?? MRState.globalNoteColorCh;
            if (typeof global.intensityScale === 'number' && Number.isFinite(global.intensityScale)) {
                MRState.globalIntensityScale = global.intensityScale;
            }
        }
        if (gemCanopy) {
            MRState.gemCanopyShimmerCh = toChannels(gemCanopy.shimmer) ?? MRState.gemCanopyShimmerCh;
            MRState.gemCanopyHueShiftCh = toChannels(gemCanopy.hueShift) ?? MRState.gemCanopyHueShiftCh;
            MRState.gemCanopyNoteColorCh = toChannels(gemCanopy.noteColor) ?? MRState.gemCanopyNoteColorCh;
            if (typeof gemCanopy.intensityScale === 'number' && Number.isFinite(gemCanopy.intensityScale)) {
                MRState.gemCanopyIntensityScale = gemCanopy.intensityScale;
            }
        }
    }

    if (typeof overrides?.skyMoon?.melodyChannel === 'number' && Number.isInteger(overrides.skyMoon.melodyChannel)) {
        MRState.skyMoonCh = overrides.skyMoon.melodyChannel;
    }
    if (typeof overrides?.luminousPlants?.trackerChannel === 'number' && Number.isInteger(overrides.luminousPlants.trackerChannel)) {
        MRState.luminousPlantTrackerChannel = overrides.luminousPlants.trackerChannel;
    }
    if (typeof overrides?.luminousPlants?.baseIntensity === 'number' && Number.isFinite(overrides.luminousPlants.baseIntensity)) {
        MRState.luminousIntensityScale = overrides.luminousPlants.baseIntensity;
    }
    if (typeof overrides?.skyWave?.propagationMs === 'number' && Number.isFinite(overrides.skyWave.propagationMs)) {
        MRState.skyWavePropagationMs = Math.max(100, overrides.skyWave.propagationMs);
    }
    if (typeof overrides?.skyWave?.decayMs === 'number' && Number.isFinite(overrides.skyWave.decayMs)) {
        MRState.skyWaveDecayMs = Math.max(100, overrides.skyWave.decayMs);
    }
    if (Array.isArray(overrides?.skyWave?.targetBiomes) && overrides.skyWave.targetBiomes.length > 0) {
        // ⚡ OPTIMIZATION: Replaced .filter() with manual loop + in-place mutation to eliminate array allocation in context syncs.
        MRState.skyWaveTargets.length = 0;
        for (let i = 0; i < overrides.skyWave.targetBiomes.length; i++) {
            const name = overrides.skyWave.targetBiomes[i];
            if (typeof name === 'string') {
                MRState.skyWaveTargets.push(name);
            }
        }
        // Fallback to default if empty
        if (MRState.skyWaveTargets.length === 0) {
            for (let i = 0; i < defaultSkyWaveTargets.length; i++) {
                MRState.skyWaveTargets.push(defaultSkyWaveTargets[i]);
            }
        }
    }
    if (overrides?.weatherReactivity && typeof overrides.weatherReactivity === 'object') {
        for (let i = 0; i < _WEATHER_KEYS.length; i++) {
            const key = _WEATHER_KEYS[i];
            const current = MRState.weatherBindings[key];
            const override = overrides.weatherReactivity[key];
            if (!override || typeof override !== 'object') continue;
            const merged: WeatherReactivityBinding = {
                channel: typeof override.channel === 'number' ? override.channel : current?.channel ?? 0,
                smoothing: typeof override.smoothing === 'number' ? override.smoothing : current?.smoothing ?? 0.15,
                scale: typeof override.scale === 'number' ? override.scale : current?.scale ?? 1.0,
            };
            MRState.weatherBindings[key] = merged;
        }
    }

    applyAtmosphereMapOverrides(overrides as { atmosphere?: Record<string, unknown> } | undefined);

    MRState.channelValidationDone = false;
}

export function syncMapMusicContext(): void {
    const context = getMapMusicContext();
    if (context.version === MRState.appliedMapMusicVersion) return;
    MRState.appliedMapMusicVersion = context.version;
    applyMapMusicContext(context.overrides);
}

// Helper to map MIDI note (0-127) to a color hue
// Helper to map MIDI note (0-127) to a color using CONFIG.noteColorMap.sky
export function mapNoteToColor(note: number, outColor: THREE.Color, palette: string = 'global') {
    if (note <= 0) return outColor.setHex(0xffffff);
    const pitchClass = note % 12;
    const noteName = CHROMATIC_SCALE[pitchClass];
    const speciesMap = CONFIG.noteColorMap[palette] || CONFIG.noteColorMap.global;
    const hexColor = speciesMap[noteName] || CONFIG.noteColorMap.global[noteName] || 0xffffff;
    outColor.setHex(hexColor);
    return outColor;
}

// --- Type Definitions ---

interface MoonState {
    isBlinking: boolean;
    blinkStartTime: number;
    nextBlinkTime: number;
    baseScale: THREE.Vector3;
    dancePhase: number;
}

// Minimal interface for WeatherSystem based on usage
export interface IWeatherSystem {
    getTwilightGlowIntensity?(cyclePos: number): number;
    isNight(): boolean;
}

// Caches to prevent repeated lookups (migrated from core idea)
const _noteNameCache: Record<string | number, string> = {};


export type { WeatherReactivityBinding } from './music-reactivity-defaults.ts';

/** Normalized target values (0–1) written each frame by MusicReactivitySystem.update(). */
export const WeatherMusicTargets = { rainIntensity: 0, thunderPulse: 0, fogDensity: 0 };

const WEATHER_TARGET_DECAY_RATE = 5.0;

export function computeWaveDistSq(plantWorldPos: THREE.Vector3, activeWave: ActiveWave | null, cameraPosition?: THREE.Vector3): number {
    if (!activeWave) return -1;
    const origin = activeWave.origin || cameraPosition || _zeroVec;
    const dx = plantWorldPos.x - origin.x;
    const dy = plantWorldPos.y - origin.y;
    const dz = plantWorldPos.z - origin.z;
    return dx * dx + dy * dy + dz * dz;
}

const _emptyAudioState: AudioData = { channelData: [] };

/** Legacy export for batcher consumers — mirrors MRState.skyMoonNoteVal */
export let _skyMoonNoteVal = 0.0;

export class MusicReactivitySystem {
    getActiveWave(): ActiveWave | null { return MRState.activeWave; }

    moon: THREE.Object3D | null = null;
    weatherSystem: IWeatherSystem | null = null;
    registeredObjects: Map<string, Set<FoliageObject>> = new Map();

    // Moon animation state
    moonState: MoonState = {
        isBlinking: false,
        blinkStartTime: 0,
        nextBlinkTime: 0,
        baseScale: new THREE.Vector3(1, 1, 1),
        dancePhase: 0
    };

    private _lastLogTime: number = 0;
    private _lastCameraPos = new THREE.Vector3();

    constructor() {
        this.scheduleNextBlink();
    }

    init(scene: THREE.Scene, weatherSystem: IWeatherSystem, beatSync?: BeatSync) {
        this.weatherSystem = weatherSystem;
        if (beatSync) {
            this.registerBeatSync(beatSync);
            registerAtmosphereBeatSync(beatSync);
        }
        // Moon registration is handled explicitly via registerMoon()
    }

    registerBeatSync(beatSync: BeatSync) {
        beatSync.onBeat((_state) => {
            // Night-gate: only fire during dusk/dawn/night
            if (uTwilight.value <= 0.1) return;
            if (MRState.skyMoonNoteVal > 0) {
                _waveColor.copy(BiomeUniforms.skyMoon.moonNoteColor.value);
                MRState.activeWave = { color: _waveColor, timestamp: performance.now(), speed: 25.0 }; // Let wave origin be undefined initially, use camera
                MRState.waveDecayStartTime = 0;
            }
        });
    }

    registerMoon(moonMesh: THREE.Object3D) {
        if (!moonMesh) return;
        this.moon = moonMesh;
        this.moonState.baseScale.copy(moonMesh.scale);
        if (!this.moon.userData) this.moon.userData = {};
    }

    registerObject(object: FoliageObject, species: string) {
        if (!object || !species) return;
        
        if (!this.registeredObjects.has(species)) {
            this.registeredObjects.set(species, new Set());
        }
        this.registeredObjects.get(species)!.add(object);

        // ⚡ OPTIMIZATION: Pre-allocate color caches during object registration to prevent GC spikes during hot-loop playback
        if (!object.userData.flashColor) {
            object.userData.flashColor = new THREE.Color();
        }

        if (object.material && !Array.isArray(object.material)) {
             const mat = object.material as THREE.MeshStandardMaterial;
             if (mat.emissive && !object.userData.originalEmissive) {
                 object.userData.originalEmissive = mat.emissive.clone();
             }
        }

        // Add minimal reactToNote method if it doesn't exist (fallback)
        if (!object.userData.reactToNote) {
            // Note: We assign to userData.reactToNote as a convention for some objects,
            // or directly to the object if it's a method.
            // In JS version it was `object.reactToNote`.
            // We'll stick to attaching it to the object instance, but TS might complain if it's not in FoliageObject type.
            // FoliageObject extends Object3D, which is dynamic.
            (object as any).reactToNote = (note: string, color: number, velocity: number) => {
                if (object.material && !Array.isArray(object.material) && (object.material as THREE.MeshStandardMaterial).emissive) {
                    // Smooth flash via animateFoliage
                    // ⚡ OPTIMIZATION: Only update values, never allocate using new THREE.Color or .clone() in the hot path
                    object.userData.flashColor.setHex(color);
                    object.userData.flashIntensity = velocity / 127.0;
                }
            };
        }
    }

    unregisterObject(object: FoliageObject, species: string) {
        if (this.registeredObjects.has(species)) {
            this.registeredObjects.get(species)!.delete(object);
        }
    }

    // Called by AudioSystem or Main loop
    handleNoteOn(note: number | string, velocity: number, channelIndex: number) {
        const noteName = this.resolveNoteName(note);

        // Determine species to trigger based on channel
        // ⚡ OPTIMIZATION: Use scratch array to avoid GC
        const speciesList = _scratchSpeciesList;
        speciesList.length = 0;

        // Example mapping logic
        if (channelIndex === 0) speciesList.push('mushroom'); // Kick/Bass
        if (channelIndex === 1) speciesList.push('flower');   // Melody
        if (channelIndex === 2) speciesList.push('tree');     // Chords
        if (channelIndex === 3) speciesList.push('cloud');    // FX

        // Also trigger global listeners if any
        speciesList.push('global');

        // ⚡ OPTIMIZATION: Trigger Batched Systems directly
        // Mushroom Batcher handles visual reaction via InstancedMesh attributes
        const noteIdx = CHROMATIC_SCALE.indexOf(noteName);
        if (noteIdx >= 0) {
            mushroomBatcher.handleNote(noteIdx, velocity);
        }

        // ⚡ OPTIMIZATION: Use for..of loop
        for (const species of speciesList) {
            const colorMap = CONFIG.noteColorMap[species] || CONFIG.noteColorMap['global'];
            const color = colorMap[noteName] || 0xFFFFFF;

            this.triggerReaction(species, noteName, color, velocity);
        }

        // Moon reaction
        if (this.moon && CONFIG.moon.blinkOnBeat && velocity > 100) {
            this.triggerMoonBlink();
        }
    }

    resolveNoteName(note: number | string): string {
        // Check cache first (string/number key)
        if (_noteNameCache[note]) {
            return _noteNameCache[note];
        }

        let result = '';
        if (typeof note === 'number') {
            result = CHROMATIC_SCALE[note % 12];
        } else if (typeof note === 'string') {
             // Strip octave if present "C4" -> "C"
            result = note.replace(/[0-9-]/g, '');
        }

        // Cache result (limit size loosely)
        _noteNameCache[note] = result;
        return result;
    }

    triggerReaction(species: string, noteName: string, color: number, velocity: number) {
        const objects = this.registeredObjects.get(species);
        if (objects) {
            for (const obj of objects) {
                // Check for method on object (legacy/dynamic)
                if ((obj as any).reactToNote) {
                    (obj as any).reactToNote(noteName, color, velocity);
                }
            }
        }
    }

    scheduleNextBlink() {
        this.moonState.nextBlinkTime = performance.now() + CONFIG.moon.blinkInterval + (Math.random() * 2000 - 1000);
    }

    triggerMoonBlink() {
        if (this.moonState.isBlinking) return;
        this.moonState.isBlinking = true;
        this.moonState.blinkStartTime = performance.now();
    }

    private updateFoliageAnimationLoop(time: number, deltaTime: number, audioState: AudioData | null, cpuAnimatedFoliage: FoliageObject[], camera: THREE.Camera, isDay: boolean, isDeepNight: boolean) {
        const isNight = !isDay;
        if (typeof isDay !== 'boolean') {
            console.warn('[Music] isDay parameter missing');
            return;
        }

// 3. Update Foliage Animation Loop
    if (cpuAnimatedFoliage && camera) {
        // Update Frustum for Culling
        _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        _frustum.setFromProjectionMatrix(_projScreenMatrix);



        // ⚡ PERFORMANCE: Debug counters
        let totalObjects = 0;
        let culledByDistance = 0;
        let culledByFrustum = 0;
        let rendered = 0;

        const cx = camera.position.x;
        const cy = camera.position.y;
        const cz = camera.position.z;

        for (let i = 0; i < cpuAnimatedFoliage.length; i++) {
        const obj = cpuAnimatedFoliage[i];
        if (!obj) continue;
        totalObjects++;

        // ⚡ PERFORMANCE: Size-based culling distances
        let cullDistanceSq = 22500; // 150 * 150 Default

        const objType = obj.userData.type;
        const objSize = obj.userData.size;
        const objRadius = obj.userData.radius || 2.0;

        if (objType === 'flower') {
            cullDistanceSq = 6400; // 80 * 80
        } else if (objType === 'mushroom') {
            // Unreachable if we skip above, but kept for logic safety
            if (objSize === 'giant') {
            cullDistanceSq = 40000; // 200 * 200
            } else {
            cullDistanceSq = 14400; // 120 * 120
            }
        } else if (objType === 'tree' || objType === 'shrub') {
            cullDistanceSq = 22500; // 150 * 150
        } else if (objType === 'cloud') {
            cullDistanceSq = 62500; // 250 * 250
        }

        // Distance Culling
        // ⚡ OPTIMIZATION: Bypassed THREE.Vector3.distanceToSquared() overhead in hot loop with raw math
        const ox = obj.position.x;
        const oy = obj.position.y;
        const oz = obj.position.z;
        const distSq = (cx - ox) * (cx - ox) + (cy - oy) * (cy - oy) + (cz - oz) * (cz - oz);

        if (distSq > cullDistanceSq) {
            culledByDistance++;
            continue;
        }

        // Frustum Culling
        let isVisible = false;
        if (obj.geometry && obj.geometry.boundingSphere) {
            isVisible = _frustum.intersectsObject(obj);
        } else {
            _scratchSphere.center.copy(obj.position);
            _scratchSphere.radius = objRadius;
            // Apply approximate scale
            if (obj.scale.x > 1.0) _scratchSphere.radius *= obj.scale.x;
            isVisible = _frustum.intersectsSphere(_scratchSphere);
        }

        if (isVisible) {
            rendered++;
            // Using animateFoliage (assumed typed correctly in animation.ts)
            // ⚡ OPTIMIZATION: Use static _emptyAudioState instead of allocating {} per frame
            animateFoliage(obj, time, audioState || _emptyAudioState, isDay, isDeepNight);
        } else {
            culledByFrustum++;
        }
        }

        // ⚡ PERFORMANCE: Debug logging every 5 seconds
        if (!this._lastLogTime || (Date.now() - this._lastLogTime) > 5000) {
        console.log(`[MusicReactivity] Objects: ${totalObjects} | Rendered: ${rendered} | Culled (Distance): ${culledByDistance} | Culled (Frustum): ${culledByFrustum}`);
        this._lastLogTime = Date.now();
        }

        // Flush batched updates to GPU
        // Pass audioState for extended animation batching (Phase 1 migration)
        const kick = audioState?.kickTrigger || 0;
        foliageBatcher.flush(time, kick, audioState);

        // Continuous day/night bias for pose state machines (0 = night, 1 = day).
        // Pure arithmetic — no allocations.
        const dayNightBias = getDayNightBias(time % CYCLE_DURATION);

        // Update Arpeggio Batcher
        arpeggioFernBatcher.update(audioState, dayNightBias);

        // Update Portamento Batcher
        portamentoPineBatcher.update(time, audioState, dayNightBias);

        // Update Flower Batchers (aPoseState driven by audio)
        flowerBatcher.update(time, deltaTime, audioState, dayNightBias);
        simpleFlowerBatcher.update(audioState);

        // Update Kick Drum Geysers
        kickDrumGeyserBatcher.update(time, deltaTime, audioState, MRState.activeWave);
        // Note: subwooferLotusBatcher responds via TSL uniforms, no JS update loop required.

        }
    }

    private updateBiomeChannelBindings(audioState: AudioData | null, dayNightBias: number) {
// ---------------------------------------------------------------
        // ⚡ BIOME CHANNEL BINDING — Arpeggio Grove & Crystalline Nebula
        // Data-driven: channel indices come from assets/music-bindings.json.
        // Allocation-free: only pre-allocated module-level scalars are used.
        // Day/night gating: reactivity is attenuated during the day phase.
        // nightGate: 1.0 at night (dayNightBias=0) → 0.2 at full day (dayNightBias=1)
        // ---------------------------------------------------------------
        const nightGate = 0.2 + (1.0 - dayNightBias) * 0.8;
        const channels = audioState?.channelData;

        if (channels && channels.length > 0) {
        // --- Bindings validation (defensive) ---
        // Warn once if music-bindings.json references tracker channels that don't exist in the current module.
        // This is cheap and prevents silent "no reactivity" bugs when swapping MODs.
        if (!MRState.channelValidationDone) {
            MRState.channelValidationDone = true;
            const allConfiguredChannels = [
            ...MRState.arpeggioShimmerCh, ...MRState.arpeggioHueShiftCh, ...MRState.arpeggioNoteColorCh,
            ...MRState.nebulaShimmerCh, ...MRState.nebulaAmplitudeCh, ...MRState.nebulaNoteColorCh,
            ...MRState.skyMoonNoteColorCh, ...MRState.skyMoonIntensityCh,
            ...MRState.globalShimmerCh, ...MRState.globalHueShiftCh, ...MRState.globalNoteColorCh,
            ...MRState.gemCanopyShimmerCh, ...MRState.gemCanopyHueShiftCh, ...MRState.gemCanopyNoteColorCh
            ];
            const maxNeeded = Math.max(0, ...allConfiguredChannels);
            if (maxNeeded >= channels.length) {
            console.warn(`[MusicReactivity] music-bindings.json references channel ${maxNeeded} but the loaded tracker only provides ${channels.length} channels. Some reactivity will be silent.`);
            }
        }

        // --- Arpeggio Grove: shimmer ---
        MRState.arpeggioShimmerAccum = 0.0;
        for (let i = 0; i < MRState.arpeggioShimmerCh.length; i++) {
            const idx = MRState.arpeggioShimmerCh[i];
            if (idx < channels.length) MRState.arpeggioShimmerAccum += channels[idx].volume;
        }

        // --- Arpeggio Grove: hue shift ---
        MRState.arpeggioHueShiftAccum = 0.0;
        for (let i = 0; i < MRState.arpeggioHueShiftCh.length; i++) {
            const idx = MRState.arpeggioHueShiftCh[i];
            if (idx < channels.length) MRState.arpeggioHueShiftAccum += channels[idx].volume;
        }

        // --- Global: shimmer ---
        MRState.globalShimmerAccum = 0.0;
        for (let i = 0; i < MRState.globalShimmerCh.length; i++) {
            const idx = MRState.globalShimmerCh[i];
            if (idx < channels.length) MRState.globalShimmerAccum += channels[idx].volume;
        }

        // --- Global: hue shift ---
        MRState.globalHueShiftAccum = 0.0;
        for (let i = 0; i < MRState.globalHueShiftCh.length; i++) {
            const idx = MRState.globalHueShiftCh[i];
            if (idx < channels.length) MRState.globalHueShiftAccum += channels[idx].volume;
        }

        // --- Gem Canopy: shimmer ---
        MRState.gemCanopyShimmerAccum = 0.0;
        for (let i = 0; i < MRState.gemCanopyShimmerCh.length; i++) {
            const idx = MRState.gemCanopyShimmerCh[i];
            if (idx < channels.length) MRState.gemCanopyShimmerAccum += channels[idx].volume;
        }

        // --- Gem Canopy: hue shift (note-hit twist driver) ---
        MRState.gemCanopyHueShiftAccum = 0.0;
        for (let i = 0; i < MRState.gemCanopyHueShiftCh.length; i++) {
            const idx = MRState.gemCanopyHueShiftCh[i];
            if (idx < channels.length) MRState.gemCanopyHueShiftAccum += channels[idx].volume;
        }

        // --- Crystalline Nebula: shimmer ---
        MRState.nebulaShimmerAccum = 0.0;
        for (let i = 0; i < MRState.nebulaShimmerCh.length; i++) {
            const idx = MRState.nebulaShimmerCh[i];
            if (idx < channels.length) MRState.nebulaShimmerAccum += channels[idx].volume;
        }

        // --- Crystalline Nebula: amplitude scale ---
        MRState.nebulaAmplitudeAccum = 0.0;
        for (let i = 0; i < MRState.nebulaAmplitudeCh.length; i++) {
            const idx = MRState.nebulaAmplitudeCh[i];
            if (idx < channels.length) MRState.nebulaAmplitudeAccum += channels[idx].volume;
        }

        MRState.skyMoonIntensityAccum = 0.0;
        MRState.skyMoonNoteVal = 0;
        MRState.arpeggioNoteVal = 0;
        MRState.nebulaNoteVal = 0;
        MRState.gemCanopyNoteVal = 0;
        // Read Intensity
        for (let i = 0; i < MRState.skyMoonIntensityCh.length; i++) {
            const idx = MRState.skyMoonIntensityCh[i];
            if (idx < channels.length) MRState.skyMoonIntensityAccum += channels[idx].volume;
        }
        // Read Note Color (use first matching channel that has volume)
        for (let i = 0; i < MRState.skyMoonNoteColorCh.length; i++) {
            const idx = MRState.skyMoonNoteColorCh[i];
            if (idx < channels.length && channels[idx].volume > 0.05) {
            MRState.skyMoonNoteVal = channels[idx].note; // Assume .note exists on the channel data
            break;
            }
        }
        // Read Arpeggio Note Color
        for (let i = 0; i < MRState.arpeggioNoteColorCh.length; i++) {
            const idx = MRState.arpeggioNoteColorCh[i];
            if (idx < channels.length && channels[idx].volume > 0.05) {
            MRState.arpeggioNoteVal = channels[idx].note;
            break;
            }
        }
        // Read Nebula Note Color
        for (let i = 0; i < MRState.nebulaNoteColorCh.length; i++) {
            const idx = MRState.nebulaNoteColorCh[i];
            if (idx < channels.length && channels[idx].volume > 0.05) {
            MRState.nebulaNoteVal = channels[idx].note;
            break;
            }
        }

        // Read Global Note Color
        for (let i = 0; i < MRState.globalNoteColorCh.length; i++) {
            const idx = MRState.globalNoteColorCh[i];
            if (idx < channels.length && channels[idx].volume > 0.05) {
            MRState.globalNoteVal = channels[idx].note;
            break;
            }
        }

        // Read Gem Canopy Note Color
        for (let i = 0; i < MRState.gemCanopyNoteColorCh.length; i++) {
            const idx = MRState.gemCanopyNoteColorCh[i];
            if (idx < channels.length && channels[idx].volume > 0.05) {
            MRState.gemCanopyNoteVal = channels[idx].note;
            break;
            }
        }

        // Push to TSL uniforms
        // Mutate .value in place: never reassign the uniform node itself.
        BiomeUniforms.arpeggioGrove.shimmer.value =
            Math.min(MRState.arpeggioShimmerAccum / Math.max(MRState.arpeggioShimmerCh.length, 1), 1.0) * nightGate * MRState.arpeggioIntensityScale;
        BiomeUniforms.arpeggioGrove.hueShift.value =
            Math.min(MRState.arpeggioHueShiftAccum / Math.max(MRState.arpeggioHueShiftCh.length, 1), 1.0) * nightGate * MRState.arpeggioIntensityScale;
        BiomeUniforms.crystallineNebula.shimmer.value =
            Math.min(MRState.nebulaShimmerAccum / Math.max(MRState.nebulaShimmerCh.length, 1), 1.0) * nightGate * MRState.nebulaIntensityScale;
        // amplitudeScale: 1.0 baseline + channel energy boost, gated by night
        BiomeUniforms.crystallineNebula.amplitudeScale.value =
            1.0 + Math.min(MRState.nebulaAmplitudeAccum / Math.max(MRState.nebulaAmplitudeCh.length, 1), 1.0) * nightGate * MRState.nebulaIntensityScale;

        BiomeUniforms.global.shimmer.value =
            Math.min(MRState.globalShimmerAccum / Math.max(MRState.globalShimmerCh.length, 1), 1.0) * nightGate * MRState.globalIntensityScale;
        BiomeUniforms.global.hueShift.value =
            Math.min(MRState.globalHueShiftAccum / Math.max(MRState.globalHueShiftCh.length, 1), 1.0) * nightGate * MRState.globalIntensityScale;

        BiomeUniforms.gemCanopy.shimmer.value =
            Math.min(MRState.gemCanopyShimmerAccum / Math.max(MRState.gemCanopyShimmerCh.length, 1), 1.0) * nightGate * MRState.gemCanopyIntensityScale;
        BiomeUniforms.gemCanopy.hueShift.value =
            Math.min(MRState.gemCanopyHueShiftAccum / Math.max(MRState.gemCanopyHueShiftCh.length, 1), 1.0) * nightGate * MRState.gemCanopyIntensityScale;

        BiomeUniforms.skyMoon.moonIntensity.value =
            Math.min(MRState.skyMoonIntensityAccum / Math.max(MRState.skyMoonIntensityCh.length, 1), 1.0) * nightGate * MRState.skyMoonIntensityScale;

        if (MRState.skyMoonNoteVal > 0) {
            mapNoteToColor(MRState.skyMoonNoteVal, _targetMoonColor);
            // Smoothly lerp towards the target color
            BiomeUniforms.skyMoon.moonNoteColor.value.lerp(_targetMoonColor, 0.1);
        } else {
            // Slowly drift back to white when no note plays
            _targetMoonColor.setHex(0xffffff);
            BiomeUniforms.skyMoon.moonNoteColor.value.lerp(_targetMoonColor, 0.05);
        }

        if (MRState.arpeggioNoteVal > 0) {
            mapNoteToColor(MRState.arpeggioNoteVal, _targetArpeggioColor);
            BiomeUniforms.arpeggioGrove.noteColor.value.lerp(_targetArpeggioColor, 0.1);
        } else {
            _targetArpeggioColor.setHex(0xffffff);
            BiomeUniforms.arpeggioGrove.noteColor.value.lerp(_targetArpeggioColor, 0.05);
        }

        if (MRState.nebulaNoteVal > 0) {
            mapNoteToColor(MRState.nebulaNoteVal, _targetNebulaColor);
            BiomeUniforms.crystallineNebula.noteColor.value.lerp(_targetNebulaColor, 0.1);
        } else {
            _targetNebulaColor.setHex(0xffffff);
            BiomeUniforms.crystallineNebula.noteColor.value.lerp(_targetNebulaColor, 0.05);
        }

        if (MRState.globalNoteVal > 0) {
            mapNoteToColor(MRState.globalNoteVal, _targetGlobalColor, 'global');
            BiomeUniforms.global.noteColor.value.lerp(_targetGlobalColor, 0.1);
        } else {
            _targetGlobalColor.setHex(0xffffff);
            BiomeUniforms.global.noteColor.value.lerp(_targetGlobalColor, 0.05);
        }

        if (MRState.gemCanopyNoteVal > 0) {
            mapNoteToColor(MRState.gemCanopyNoteVal, _targetGemCanopyColor, 'gem_canopy');
            BiomeUniforms.gemCanopy.noteColor.value.lerp(_targetGemCanopyColor, 0.12);
            const shimmer = BiomeUniforms.gemCanopy.shimmer.value;
            if (shimmer > 0.2) {
                awakenedPersistence.tryAwakenNearby(
                    'gem_canopy_tree',
                    this._lastCameraPos,
                    shimmer,
                    _targetGemCanopyColor.getHex()
                );
            }
        } else {
            _targetGemCanopyColor.setHex(0xffffff);
            BiomeUniforms.gemCanopy.noteColor.value.lerp(_targetGemCanopyColor, 0.05);
        }
        } else {
        // No audio data — smoothly decay towards resting values (no snapping).
        BiomeUniforms.arpeggioGrove.shimmer.value *= 0.9;
        BiomeUniforms.arpeggioGrove.hueShift.value *= 0.9;
        BiomeUniforms.crystallineNebula.shimmer.value *= 0.9;
        // Decay amplitude towards baseline 1.0
        BiomeUniforms.crystallineNebula.amplitudeScale.value =
            1.0 + (BiomeUniforms.crystallineNebula.amplitudeScale.value - 1.0) * 0.9;

        BiomeUniforms.global.shimmer.value *= 0.9;
        BiomeUniforms.global.hueShift.value *= 0.9;
        BiomeUniforms.gemCanopy.shimmer.value *= 0.9;
        BiomeUniforms.gemCanopy.hueShift.value *= 0.9;

        BiomeUniforms.skyMoon.moonIntensity.value *= 0.9;
        _targetMoonColor.setHex(0xffffff);
        BiomeUniforms.skyMoon.moonNoteColor.value.lerp(_targetMoonColor, 0.05);

        _targetArpeggioColor.setHex(0xffffff);
        BiomeUniforms.arpeggioGrove.noteColor.value.lerp(_targetArpeggioColor, 0.05);

        _targetNebulaColor.setHex(0xffffff);
        BiomeUniforms.crystallineNebula.noteColor.value.lerp(_targetNebulaColor, 0.05);

        _targetGlobalColor.setHex(0xffffff);
        BiomeUniforms.global.noteColor.value.lerp(_targetGlobalColor, 0.05);

        _targetGemCanopyColor.setHex(0xffffff);
        BiomeUniforms.gemCanopy.noteColor.value.lerp(_targetGemCanopyColor, 0.05);
        }
    }

    private updateLuminousPlants(audioState: AudioData | null, isDay: boolean) {
// ---------------------------------------------------------------
        // ⚡ LUMINOUS PLANTS (Scenic System)
        // Tracker channel defined in assets/music-bindings.json.
        // ---------------------------------------------------------------
        const channels = audioState?.channelData;
        if (channels && MRState.luminousPlantTrackerChannel < channels.length) {
            const lpData = channels[MRState.luminousPlantTrackerChannel];

            let dominantNote = 0;
            let maxAmp = 0.0;

            for (let i = 0; i < 12; i++) {
            if (lpData.notes[i] > maxAmp) {
                maxAmp = lpData.notes[i];
                dominantNote = i;
            }
            }

            // Add a threshold
            const targetIntensity = maxAmp > 0.1 ? maxAmp * MRState.luminousIntensityScale : 0.0;

            // 1-pole IIR smoothing (Zero-allocation)
            LuminousPlantUniforms.intensity.value += (targetIntensity - LuminousPlantUniforms.intensity.value) * 0.15;

            // Only snap note index when amplitude is high enough
            if (targetIntensity > 0.2) {
            // Map chromatic note index (0-11) across 128 LUT slots exactly like sky_moon
            LuminousPlantUniforms.noteIndex.value = Math.min(Math.floor((dominantNote / 12) * 128), 127);

            // Awakened persistence: first music reaction near player awakens nearby luminous plants
                const noteName = CHROMATIC_SCALE[dominantNote];
                const noteColor = CONFIG.noteColorMap.luminous_plants?.[noteName]
                    ?? CONFIG.noteColorMap.global?.[noteName];
                awakenedPersistence.tryAwakenNearby(
                    'luminous_plant',
                    this._lastCameraPos,
                    targetIntensity,
                    typeof noteColor === 'number' ? noteColor : undefined
                );
            }
        }
        // Day guard: clamp intensity to 0 when daytime so sky/moon are unchanged.
        SkyUniforms.intensity.value = (!isDay) ? Math.min(MRState.smoothedSkyIntensity, 1.0) : 0.0;
    }

    private updateSkyWavePropagation(audioState: AudioData | null, isDay: boolean, cameraPosition?: THREE.Vector3, deltaTime: number = 0.016) {
        const nightGate = isDay ? 0.0 : 1.0;
// ---------------------------------------------------------------
        // ⚡ SKY WAVE — Per-channel MOD note-color wave propagation
        // When a sky/moon note fires on the beat (via BeatSync), its hue cascades
        // to the noteColor uniforms listed in music-bindings.json sky_wave.target_biomes.
        // Order in the array controls stagger (earlier targets receive the color first).
        // Foliage that already .mul() one of the hub noteColors (arpeggioGrove or crystallineNebula)
        // — e.g. portamento-pine, wisteria-cluster, many trees/mushrooms — get the sky hue automatically.
        // Zero allocations: all state is module-level.
        // Music Impact: the primary "sky talks to ground" visual sync mechanism.
        // ---------------------------------------------------------------
        const twilightVal = uTwilight.value;
        if (twilightVal > 0.1) {
            if (MRState.activeWave) {
                const elapsed = (performance.now() - MRState.activeWave.timestamp) / MRState.skyWavePropagationMs;
                const targets: readonly string[] = MRState.skyWaveTargets;

                let allComplete = true;
                for (let i = 0; i < targets.length; i++) {
                    const key = targets[i];
                    const uni = skyWaveUniformMap[key];
                    if (!uni) continue;

                    // Stagger arrival: ~0.22 of propagation per step in the list
                    const phaseStart = i * 0.22;
                    if (elapsed > phaseStart) {
                        const localT = Math.min((elapsed - phaseStart) / 0.68, 1.0);
                        // Gentle influence so it feels like a traveling wave, not a hard cut
                        uni.value.lerp(MRState.activeWave.color, localT * 0.32);
                        allComplete = false;
                    }
                }

                if (elapsed >= 1.0 || allComplete) {
                    MRState.activeWave = null;
                    MRState.waveDecayStartTime = performance.now();
                }
            } else if (MRState.waveDecayStartTime > 0) {
                const decayElapsed = performance.now() - MRState.waveDecayStartTime;
                const targets: readonly string[] = MRState.skyWaveTargets;

                if (decayElapsed < MRState.skyWaveDecayMs) {
                    for (const key of targets) {
                        const uni = skyWaveUniformMap[key];
                        if (uni) uni.value.lerp(_whiteColor, 0.06);
                    }
                } else {
                    MRState.waveDecayStartTime = 0;
                    for (const key of targets) {
                        const uni = skyWaveUniformMap[key];
                        if (uni) uni.value.copy(_whiteColor);
                    }
                }
            }
        } else {
            // Dawn guard: clear active wave and decay to white for every targeted uniform
            if (MRState.activeWave) {
                MRState.activeWave = null;
                MRState.waveDecayStartTime = performance.now();
            }
            // Also gently clear any lingering wave color on targets (defensive)
            const targets: readonly string[] = MRState.skyWaveTargets;
            for (const key of targets) {
                const uni = skyWaveUniformMap[key];
                if (uni) uni.value.lerp(_whiteColor, 0.04);
            }
        }

        // ---------------------------------------------------------------
        // ⚡ WEATHER MUSIC REACTIVITY — channel amplitude → weather targets
        // Data-driven: channel indices come from assets/music-bindings.json weatherReactivity.
        // Exponential moving average keyed to deltaTime for frame-rate independence.
        // Targets decay to zero when disabled so mid-game toggle leaves no stuck state.
        // ---------------------------------------------------------------
        if (CONFIG.weather.musicReactivity.enabled && audioState?.channelData) {
            const ch = audioState.channelData;
            const smooth = (current: number, target: number, k: number) =>
                current + (target - current) * (1.0 - Math.exp(-k * deltaTime));

            if (MRState.weatherBindings.rainIntensity) {
                const b = MRState.weatherBindings.rainIntensity;
                const idx = b.channel;
                const raw = idx < ch.length ? (ch[idx].volume * b.scale) : 0;
                WeatherMusicTargets.rainIntensity = smooth(WeatherMusicTargets.rainIntensity, Math.min(raw, 1.0), b.smoothing);
            }
            if (MRState.weatherBindings.thunderPulse) {
                const b = MRState.weatherBindings.thunderPulse;
                const idx = b.channel;
                const raw = idx < ch.length ? (ch[idx].volume * b.scale) : 0;
                WeatherMusicTargets.thunderPulse = smooth(WeatherMusicTargets.thunderPulse, Math.min(raw, 1.0), b.smoothing);
            }
            if (MRState.weatherBindings.fogDensity) {
                const b = MRState.weatherBindings.fogDensity;
                const idx = b.channel;
                const raw = idx < ch.length ? (ch[idx].volume * b.scale) : 0;
                WeatherMusicTargets.fogDensity = smooth(WeatherMusicTargets.fogDensity, Math.min(raw, 1.0), b.smoothing);
            }
        } else {
            // Feature off or no channel data — exponentially decay targets to zero.
            // Gradual decay (~200 ms time constant) prevents abrupt transitions on mid-game toggle.
            const decayFactor = 1.0 - Math.exp(-deltaTime * WEATHER_TARGET_DECAY_RATE);
            WeatherMusicTargets.rainIntensity -= WeatherMusicTargets.rainIntensity * decayFactor;
            WeatherMusicTargets.thunderPulse  -= WeatherMusicTargets.thunderPulse  * decayFactor;
            WeatherMusicTargets.fogDensity    -= WeatherMusicTargets.fogDensity    * decayFactor;
            // Clamp to zero below threshold to avoid denormals
            if (WeatherMusicTargets.rainIntensity < 0.001) WeatherMusicTargets.rainIntensity = 0;
            if (WeatherMusicTargets.thunderPulse  < 0.001) WeatherMusicTargets.thunderPulse  = 0;
            if (WeatherMusicTargets.fogDensity    < 0.001) WeatherMusicTargets.fogDensity    = 0;
        }
    }

    updateTwilightGlow(time: number) {
        if (!this.weatherSystem) return;

        // Get smooth twilight intensity (0 = day, 1 = night peak)
        const cyclePos = time % CYCLE_DURATION;
        const glowIntensity = (this.weatherSystem.getTwilightGlowIntensity)
            ? this.weatherSystem.getTwilightGlowIntensity(cyclePos)
            : 0.0;

        // ⚡ OPTIMIZATION: Removed mushroom loop.
        // TSL handles global uTwilight uniform for glow base.
        // Bioluminescence logic is now in MushroomBatcher material.
    }

    update(
        time: number,
        deltaTime: number,
        audioState: AudioData | null,
        weatherSystem: IWeatherSystem,
        cpuAnimatedFoliage: FoliageObject[],
        camera: THREE.Camera,
        isDay: boolean,
        isDeepNight: boolean
    ) {
        syncMapMusicContext();
        // 1. Update Moon Animation
        this.updateMoon(time, deltaTime);

        // 2. Update Twilight Glow
        this.updateTwilightGlow(time);

                this.updateFoliageAnimationLoop(time, deltaTime, audioState, cpuAnimatedFoliage, camera, isDay, isDeepNight);

        this._lastCameraPos.copy(camera.position);

        this.updateBiomeChannelBindings(audioState, getDayNightBias(time % CYCLE_DURATION));

// ---------------------------------------------------------------
            // ⚡ MOON DANCE — Note-colour hue reactivity for sky and moon glow
            // Data-driven: channel index from assets/music-bindings.json sky_moon.
            // Allocation-free: only pre-allocated module-level scalars used.
            // Day/night gating: intensity = 0 during day — no shader branch.
            // ---------------------------------------------------------------
            const skyMoonCh = audioState?.channelData;
            if (skyMoonCh && MRState.skyMoonCh < skyMoonCh.length) {
                const chData = skyMoonCh[MRState.skyMoonCh];
                const rawVolume = chData.volume || 0;

                // Resolve chromatic note index (0–11) from the channel's note string.
                // Uses the already-loaded _noteNameCache / CHROMATIC_SCALE.
                const noteStr: string = (chData as any).note || '';
                if (noteStr) {
                    const noteName = noteStr.replace(/[0-9-]/g, '');
                    const chromaticIdx = CHROMATIC_SCALE.indexOf(noteName);
                    if (chromaticIdx >= 0) {
                        // Map 12 chromatic notes evenly across 128 LUT slots.
                        // Using floor((idx / 12) * 128) gives slots 0,10,21,...,117 for C–B.
                        MRState.lastSkyNoteIndex = Math.min(Math.floor((chromaticIdx / 12) * 128), 127);
                    }
                }

                // One-pole IIR smoothing — eliminates staccato strobe on note-on events.
                // Time constant ≈ 1/12 s (~83 ms): fast enough to track melody, slow enough to avoid flicker.
                MRState.smoothedSkyIntensity += (rawVolume - MRState.smoothedSkyIntensity) * (1.0 - Math.exp(-deltaTime * 12.0));
            } else {
                // No channel data — decay intensity to zero smoothly.
                MRState.smoothedSkyIntensity *= 0.9;
                if (MRState.smoothedSkyIntensity < 0.001) MRState.smoothedSkyIntensity = 0.0;
            }

            // Push to TSL uniforms — mutate .value only, never reassign nodes.
            SkyUniforms.noteIndex.value = MRState.lastSkyNoteIndex;
                    this.updateLuminousPlants(audioState, !isDay);

        this.updateSkyWavePropagation(audioState, isDay, camera.position, deltaTime);

        updateAtmosphereReactivity(
            audioState,
            deltaTime,
            getDayNightBias(time % CYCLE_DURATION),
            isDay,
            WeatherMusicTargets.fogDensity
        );
    }

    updateMoon(time: number, deltaTime: number) {
        if (!this.moon) return;

        // Only animate moon at night
        const isNight = this.weatherSystem ? this.weatherSystem.isNight() : true;

        if (!isNight) {
            this.moon.scale.copy(this.moonState.baseScale);
            return;
        }

        const now = performance.now();

        // Handle Blinking
        if (!this.moonState.isBlinking && now > this.moonState.nextBlinkTime) {
            this.triggerMoonBlink();
        }

        if (this.moonState.isBlinking) {
            const elapsed = now - this.moonState.blinkStartTime;
            const progress = elapsed / CONFIG.moon.blinkDuration;
            const mesh = this.moon.children[0] as THREE.Mesh;

            if (progress >= 1) {
                this.moonState.isBlinking = false;
                this.moon.scale.copy(this.moonState.baseScale);
                if (mesh && (mesh.material as any).uBlink) {
                    (mesh.material as any).uBlink.value = 0;
                }
                this.scheduleNextBlink();
            } else {
                // Simple scale blink (squash Y)
                const blinkCurve = Math.sin(progress * Math.PI);
                const scaleY = 1.0 - (blinkCurve * 0.8);

                this.moon.scale.set(
                    this.moonState.baseScale.x,
                    this.moonState.baseScale.y * scaleY,
                    this.moonState.baseScale.z
                );

                // Update emissive uniform
                if (mesh && (mesh.material as any).uBlink) {
                    (mesh.material as any).uBlink.value = blinkCurve;
                }
            }
        }

        // Handle Dancing
        if (CONFIG.moon.danceAmplitude > 0) {
            this.moonState.dancePhase += deltaTime * CONFIG.moon.danceFrequency;
            const danceOffset = Math.sin(this.moonState.dancePhase) * CONFIG.moon.danceAmplitude;
            this.moon.rotation.z = danceOffset * 0.2; // Tilt
        }
    }
}

export const musicReactivitySystem = new MusicReactivitySystem();

// ⚡ Bolt: Removed array allocations from applyMapMusicContext

