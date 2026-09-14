import {
    type IWeatherSystem,
    MRState,
    syncMapMusicContext,
    mapNoteToColor,
    applyArpeggioGroveChannelAccum,
    applyNebulaChannelAccum,
    WeatherMusicTargets,
    _frustum,
    _projScreenMatrix,
    _scratchSphere,
    _targetMoonColor,
    _targetArpeggioColor,
    _targetNebulaColor,
    _targetGlobalColor,
    _targetGemCanopyColor,
    _targetSkyIslandsColor,
    _targetSugarCavesColor,
    _waveColor,
    _whiteColor,
    getActiveWave as readActiveWave,
    setActiveWave,
} from './music-reactivity-core.ts';
export * from './music-reactivity-core.ts';
export { AtmosphereShaftState } from './atmosphere-reactivity.ts';
export { computeWaveDistSq } from './music-wave.ts';
import * as THREE from 'three';
import { updateSkyWavePropagation } from './music-reactivity-sky-wave.ts';

import { updateLuminousPlants } from './music-reactivity-luminous.ts';

import { updateFoliageAnimationLoop } from './music-reactivity-foliage.ts';
import { updateBiomeChannelBindings } from './music-reactivity-bindings.ts';
import { NOTE_AUDIBLE_THRESHOLD, NOTE_COLOR_RELEASE_LERP, SILENT_DECAY, SILENT_DECAY_UNIFORMS, accumChannelVolume, firstAudibleNote, normalizeAccum, releaseNoteColor, applyNoteColor } from './music-reactivity-bindings.ts';

import { BeatSync } from '../audio/beat-sync.ts';
import { shouldUseFoliageGpuBatch } from '../compute/foliage-gpu-batch.ts';
import { CONFIG, CYCLE_DURATION } from '../core/config.ts';
import { getDayNightBias } from '../core/cycle.ts';
import { animateFoliage } from '../foliage/animation.ts';
import { arpeggioFernBatcher } from '../foliage/arpeggio-batcher.ts';
import { foliageBatcher } from '../foliage/batcher/index.ts';
import { flowerBatcher } from '../foliage/flower-batcher.ts';
import { kickDrumGeyserBatcher } from '../foliage/kick-drum-geyser-batcher.ts';
import { mushroomBatcher } from '../foliage/mushroom-batcher.ts';
import { portamentoPineBatcher } from '../foliage/portamento-batcher.ts';
import { simpleFlowerBatcher } from '../foliage/simple-flower-batcher.ts';
import { uTwilight } from '../foliage/sky.ts';
import type { AudioData, ChannelData, FoliageObject } from '../foliage/types.ts';
import {
    uploadPositionsFlat,
    batchDistanceCull,
    WASM_POSITION_OBJECT_CAPACITY,
} from '../utils/wasm-batch.ts';
import {
    updateAtmosphereReactivity,
    registerAtmosphereBeatSync,
    applyAtmosphereMapOverrides,
} from './atmosphere-reactivity.ts';
import { awakenedPersistence } from './awakened-persistence-api.ts';
import { BiomeUniforms, SkyUniforms, LuminousPlantUniforms } from './biome-uniforms.ts';
import { CHROMATIC_SCALE, skyWaveUniformMap } from './music-reactivity-defaults.ts';
import type { ActiveWave } from './music-wave.ts';

// Decay rate for WeatherMusicTargets when feature is disabled (~200 ms time constant)
export const WEATHER_TARGET_DECAY_RATE = 5.0;

// Pre-allocated static fallback to prevent per-frame object allocation when audio is inactive
export const _emptyAudioState: AudioData = {
    channelData: [],
    kickTrigger: 0,
    grooveAmount: 0,
    beatPhase: 0,
    patternIndex: 0,
};
const _scratchSpeciesList: string[] = [];

// --- Type Definitions ---

interface MoonState {
    isBlinking: boolean;
    blinkStartTime: number;
    nextBlinkTime: number;
    baseScale: THREE.Vector3;
    dancePhase: number;
}

// Caches to prevent repeated lookups (migrated from core idea)
const _noteNameCache: Record<string | number, string> = {};

// ⚡ OPTIMIZATION: Bypassed regex .replace() to prevent GC spikes
function stripNoteOctave(str: string): string {
    let hasNumbers = false;
    let startIdx = 0;

    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if ((c >= 48 && c <= 57) || c === 45) {
            hasNumbers = true;
            startIdx = i;
            break;
        }
    }
    if (!hasNumbers) return str;

    // Notes are formatted like "C4", "C#4", "F#-1". The substring before
    // the first number/hyphen is the note name. .substring() is highly
    // optimized in JS engines (often a sliced string pointer).
    return str.substring(0, startIdx);
}

// --- Biome channel binding helpers ---------------------------------------
// These replace ~19 hand-unrolled copies of the same three loops (one per
// biome × per bound uniform) that updateBiomeChannelBindings used to carry.
// All are allocation-free and take the channel list by argument rather than
// capturing it: applyMapMusicContext() *reassigns* the MRState.*Ch arrays when
// a map override loads, so a cached reference would silently freeze reactivity
// on the default bindings.
export class MusicReactivitySystem {
    getActiveWave(): ActiveWave | null {
        return readActiveWave();
    }

    moon: THREE.Object3D | null = null;
    weatherSystem: IWeatherSystem | null = null;
    registeredObjects: Map<string, Set<FoliageObject>> = new Map();

    // Moon animation state
    moonState: MoonState = {
        isBlinking: false,
        blinkStartTime: 0,
        nextBlinkTime: 0,
        baseScale: new THREE.Vector3(1, 1, 1),
        dancePhase: 0,
    };

    private _lastLogTime: number = 0;

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
                MRState.activeWave = {
                    color: _waveColor,
                    timestamp: performance.now(),
                    speed: 25.0,
                }; // Let wave origin be undefined initially, use camera
                setActiveWave(MRState.activeWave);
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
                if (
                    object.material &&
                    !Array.isArray(object.material) &&
                    (object.material as THREE.MeshStandardMaterial).emissive
                ) {
                    // Smooth flash via animateFoliage
                    // ⚡ OPTIMIZATION: Only update values, never allocate using new THREE.Color or .clone() in the hot path
                    if (object.userData.flashColor) object.userData.flashColor.setHex(color);
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
        if (channelIndex === 1) speciesList.push('flower'); // Melody
        if (channelIndex === 2) speciesList.push('tree'); // Chords
        if (channelIndex === 3) speciesList.push('cloud'); // FX

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
            const color = colorMap[noteName] || 0xffffff;

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
            result = stripNoteOctave(note);
        }

        // Cache result (limit size loosely)
        _noteNameCache[note] = result;
        return result;
    }

    triggerReaction(_species: string, _noteName: string, _color: number, _velocity: number) {
        // ⚡ OPTIMIZATION: Bypassed O(N) registeredObjects traversal for reactToNote.
        // Visual reactivity is handled natively by TSL uniforms in the respective batchers.
    }

    scheduleNextBlink() {
        this.moonState.nextBlinkTime =
            performance.now() + CONFIG.moon.blinkInterval + (Math.random() * 2000 - 1000);
    }

    triggerMoonBlink() {
        if (this.moonState.isBlinking) return;
        this.moonState.isBlinking = true;
        this.moonState.blinkStartTime = performance.now();
    }









    updateTwilightGlow(time: number) {
        if (!this.weatherSystem) return;

        // Get smooth twilight intensity (0 = day, 1 = night peak)
        const cyclePos = time % CYCLE_DURATION;
        const glowIntensity = this.weatherSystem.getTwilightGlowIntensity
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

        updateFoliageAnimationLoop(
            time,
            deltaTime,
            audioState,
            cpuAnimatedFoliage,
            camera,
            isDay,
            isDeepNight
        );

        updateBiomeChannelBindings(audioState, getDayNightBias(time % CYCLE_DURATION), camera.position);

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
                const noteName = stripNoteOctave(noteStr);
                const chromaticIdx = CHROMATIC_SCALE.indexOf(noteName);
                if (chromaticIdx >= 0) {
                    // Map 12 chromatic notes evenly across 128 LUT slots.
                    // Using floor((idx / 12) * 128) gives slots 0,10,21,...,117 for C–B.
                    MRState.lastSkyNoteIndex = Math.min(Math.floor((chromaticIdx / 12) * 128), 127);
                }
            }

            // One-pole IIR smoothing — eliminates staccato strobe on note-on events.
            // Time constant ≈ 1/12 s (~83 ms): fast enough to track melody, slow enough to avoid flicker.
            MRState.smoothedSkyIntensity +=
                (rawVolume - MRState.smoothedSkyIntensity) * (1.0 - Math.exp(-deltaTime * 12.0));
        } else {
            // No channel data — decay intensity to zero smoothly.
            MRState.smoothedSkyIntensity *= 0.9;
            if (MRState.smoothedSkyIntensity < 0.001) MRState.smoothedSkyIntensity = 0.0;
        }

        // Push to TSL uniforms — mutate .value only, never reassign nodes.
        SkyUniforms.noteIndex.value = MRState.lastSkyNoteIndex;
        updateLuminousPlants(audioState, !isDay, camera.position);

        updateSkyWavePropagation(audioState, isDay, camera.position, deltaTime);

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
                const scaleY = 1.0 - blinkCurve * 0.8;

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
