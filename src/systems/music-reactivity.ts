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
const WEATHER_TARGET_DECAY_RATE = 5.0;

// Pre-allocated static fallback to prevent per-frame object allocation when audio is inactive
const _emptyAudioState: AudioData = {
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

/** Volume above which a channel counts as playing a note. */
const NOTE_AUDIBLE_THRESHOLD = 0.05;
/** Per-frame lerp back towards white once a biome's note channel goes silent. */
const NOTE_COLOR_RELEASE_LERP = 0.05;
/** Per-frame multiplier applied to reactive uniforms while audio is inactive. */
const SILENT_DECAY = 0.9;

/** Uniforms that simply decay towards zero when there is no audio data. */
const SILENT_DECAY_UNIFORMS = [
    BiomeUniforms.arpeggioGrove.shimmer,
    BiomeUniforms.arpeggioGrove.hueShift,
    BiomeUniforms.crystallineNebula.shimmer,
    BiomeUniforms.global.shimmer,
    BiomeUniforms.global.hueShift,
    BiomeUniforms.gemCanopy.shimmer,
    BiomeUniforms.gemCanopy.hueShift,
    BiomeUniforms.skyIslands.shimmer,
    BiomeUniforms.skyIslands.hueShift,
    BiomeUniforms.sugarCaves.shimmer,
    BiomeUniforms.sugarCaves.hueShift,
    BiomeUniforms.skyMoon.moonIntensity,
] as const;

/** Sum the volume of every configured channel that exists in this module. */
function accumChannelVolume(chList: readonly number[], channels: readonly ChannelData[]): number {
    let sum = 0.0;
    for (let i = 0; i < chList.length; i++) {
        const idx = chList[i];
        if (idx < channels.length) sum += channels[idx].volume;
    }
    return sum;
}

/** Note value of the first configured channel that is audible; 0 if none is. */
function firstAudibleNote(chList: readonly number[], channels: readonly ChannelData[]): number {
    for (let i = 0; i < chList.length; i++) {
        const idx = chList[i];
        if (idx < channels.length && channels[idx].volume > NOTE_AUDIBLE_THRESHOLD) {
            return parseInt(channels[idx].note) || 0;
        }
    }
    return 0;
}

/** Channel accumulator → 0..1 uniform value, day/night gated and map scaled. */
function normalizeAccum(
    accum: number,
    chList: readonly number[],
    nightGate: number,
    intensityScale: number
): number {
    return Math.min(accum / Math.max(chList.length, 1), 1.0) * nightGate * intensityScale;
}

/**
 * Drift a biome's noteColor uniform back towards white. `target` is a
 * module-level scratch Color — never allocate one here.
 */
function releaseNoteColor(uniform: { value: THREE.Color }, target: THREE.Color) {
    target.setHex(0xffffff);
    uniform.value.lerp(target, NOTE_COLOR_RELEASE_LERP);
}

/**
 * Lerp a biome's noteColor uniform towards the colour of the note it is
 * playing, or release it towards white when silent. Returns true if a note was
 * playing, so callers can hang biome-specific behaviour off a note hit.
 */
function applyNoteColor(
    uniform: { value: THREE.Color },
    noteVal: number,
    target: THREE.Color,
    palette: string,
    lerpRate: number
): boolean {
    if (noteVal > 0) {
        mapNoteToColor(noteVal, target, palette);
        uniform.value.lerp(target, lerpRate);
        return true;
    }
    releaseNoteColor(uniform, target);
    return false;
}

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

    private _batchPositionsBuffer = new Float32Array(0);
    private _batchPositionsCapacity = 0;

    private ensureBatchPositionsCapacity(neededCount: number) {
        if (neededCount <= this._batchPositionsCapacity) return;
        let next = Math.max(this._batchPositionsCapacity * 2, 16);
        while (next < neededCount) next *= 2;
        const nextBuf = new Float32Array(next * 4);
        nextBuf.set(this._batchPositionsBuffer.subarray(0, this._batchPositionsCapacity * 4));
        this._batchPositionsBuffer = nextBuf;
        this._batchPositionsCapacity = next;
    }

    private updateFoliageAnimationLoop(
        time: number,
        deltaTime: number,
        audioState: AudioData | null,
        cpuAnimatedFoliage: FoliageObject[],
        camera: THREE.Camera,
        isDay: boolean,
        isDeepNight: boolean
    ) {
        // ⚡ OPTIMIZATION: Short-circuit CPU math if the GPU compute shader is handling instances
        if (shouldUseFoliageGpuBatch(cpuAnimatedFoliage?.length || 0)) {
            return;
        }

        if (typeof isDay !== 'boolean') {
            console.warn('[Music] isDay parameter missing');
            return;
        }

        // 3. Update Foliage Animation Loop
        if (cpuAnimatedFoliage && camera) {
            // Update Frustum for Culling
            _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            _frustum.setFromProjectionMatrix(_projScreenMatrix);

            const cx = camera.position.x;
            const cy = camera.position.y;
            const cz = camera.position.z;

            // Ensure buffer has enough capacity (zero allocation if it's already large enough)
            const n = cpuAnimatedFoliage.length;
            this.ensureBatchPositionsCapacity(n);
            const wasmCount = Math.min(n, WASM_POSITION_OBJECT_CAPACITY);

            // Fill float buffer densely in a tight loop
            const buf = this._batchPositionsBuffer;
            for (let i = 0; i < n; i++) {
                const obj = cpuAnimatedFoliage[i];
                if (!obj) continue;

                const base = i * 4;
                buf[base] = obj.position.x;
                buf[base + 1] = obj.position.y;
                buf[base + 2] = obj.position.z;
                buf[base + 3] =
                    (obj.userData.radius || 2.0) * (obj.scale.x > 1.0 ? obj.scale.x : 1.0);
            }

            // Upload to WASM via flat float array (capped to AS position buffer capacity)
            uploadPositionsFlat(buf, wasmCount);

            // ⚡ OPTIMIZATION: Bypassed CPU distance math with WASM batchDistanceCull
            const { flags } =
                wasmCount > 0
                    ? batchDistanceCull(cx, cy, cz, 250, wasmCount)
                    : { flags: null as Float32Array | null };

            for (let i = 0; i < n; i++) {
                const obj = cpuAnimatedFoliage[i];
                if (!obj) continue;

                // Base max distance check (from WASM flags) — only for indices uploaded to WASM
                if (flags && i < wasmCount && flags[i] === 0) {
                    continue;
                }

                const ox = obj.position.x;
                const oy = obj.position.y;
                const oz = obj.position.z;

                // Frustum Culling
                let isVisible = false;
                _scratchSphere.center.x = ox;
                _scratchSphere.center.y = oy;
                _scratchSphere.center.z = oz;
                _scratchSphere.radius =
                    (obj.userData.radius || 2.0) * (obj.scale.x > 1.0 ? obj.scale.x : 1.0);
                isVisible = _frustum.intersectsSphere(_scratchSphere);

                if (isVisible) {
                    // Using animateFoliage (assumed typed correctly in animation.ts)
                    // ⚡ OPTIMIZATION: Use static _emptyAudioState instead of allocating {} per frame
                    animateFoliage(obj, time, audioState || _emptyAudioState, isDay);
                }
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
            simpleFlowerBatcher.update(time, deltaTime, audioState, dayNightBias);

            // Update Kick Drum Geysers
            kickDrumGeyserBatcher.update(time, deltaTime, audioState, MRState.activeWave);
            // Note: subwooferLotusBatcher responds via TSL uniforms, no JS update loop required.
        }
    }

    private updateBiomeChannelBindings(audioState: AudioData | null, dayNightBias: number) {
        // ---------------------------------------------------------------
        // ⚡ BIOME CHANNEL BINDING
        // Data-driven: channel indices come from assets/music-bindings.json.
        // Allocation-free: only pre-allocated module-level scalars are used.
        // Day/night gating: reactivity is attenuated during the day phase.
        // nightGate: 1.0 at night (dayNightBias=0) → 0.2 at full day (dayNightBias=1)
        //
        // Ordering note: update() calls this before updateLuminousPlants() and
        // updateSkyWavePropagation(), but that order is incidental — neither of
        // those reads BiomeUniforms or the MRState accumulators written here.
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
                    ...MRState.arpeggioShimmerCh,
                    ...MRState.arpeggioHueShiftCh,
                    ...MRState.arpeggioNoteColorCh,
                    ...MRState.nebulaShimmerCh,
                    ...MRState.nebulaAmplitudeCh,
                    ...MRState.nebulaNoteColorCh,
                    ...MRState.skyMoonNoteColorCh,
                    ...MRState.skyMoonIntensityCh,
                    ...MRState.globalShimmerCh,
                    ...MRState.globalHueShiftCh,
                    ...MRState.globalNoteColorCh,
                    ...MRState.gemCanopyShimmerCh,
                    ...MRState.gemCanopyHueShiftCh,
                    ...MRState.gemCanopyNoteColorCh,
                    ...MRState.skyIslandsShimmerCh,
                    ...MRState.skyIslandsHueShiftCh,
                    ...MRState.skyIslandsNoteColorCh,
                    ...MRState.skyIslandsFogCh,
                    ...MRState.sugarCavesShimmerCh,
                    ...MRState.sugarCavesHueShiftCh,
                    ...MRState.sugarCavesNoteColorCh,
                ];
                const maxNeeded = Math.max(0, ...allConfiguredChannels);
                if (maxNeeded >= channels.length) {
                    console.warn(
                        `[MusicReactivity] music-bindings.json references channel ${maxNeeded} but the loaded tracker only provides ${channels.length} channels. Some reactivity will be silent.`
                    );
                }
            }

            // --- Arpeggio Grove: shimmer + hueShift (#1364 AS batch / TS fallback) ---
            applyArpeggioGroveChannelAccum(channels, nightGate);

            // --- Crystalline Nebula: shimmer + amplitudeScale + noteColor ---
            applyNebulaChannelAccum(channels, nightGate);

            // --- Accumulate per-biome channel energy ---
            MRState.globalShimmerAccum = accumChannelVolume(MRState.globalShimmerCh, channels);
            MRState.globalHueShiftAccum = accumChannelVolume(MRState.globalHueShiftCh, channels);
            MRState.gemCanopyShimmerAccum = accumChannelVolume(
                MRState.gemCanopyShimmerCh,
                channels
            );
            MRState.gemCanopyHueShiftAccum = accumChannelVolume(
                MRState.gemCanopyHueShiftCh,
                channels
            );
            MRState.skyIslandsShimmerAccum = accumChannelVolume(
                MRState.skyIslandsShimmerCh,
                channels
            );
            MRState.skyIslandsHueShiftAccum = accumChannelVolume(
                MRState.skyIslandsHueShiftCh,
                channels
            );
            MRState.skyIslandsFogAccum = accumChannelVolume(MRState.skyIslandsFogCh, channels);
            MRState.sugarCavesShimmerAccum = accumChannelVolume(
                MRState.sugarCavesShimmerCh,
                channels
            );
            MRState.sugarCavesHueShiftAccum = accumChannelVolume(
                MRState.sugarCavesHueShiftCh,
                channels
            );
            MRState.skyMoonIntensityAccum = accumChannelVolume(
                MRState.skyMoonIntensityCh,
                channels
            );

            // --- Read the note playing on each biome's note-colour channel ---
            MRState.skyMoonNoteVal = firstAudibleNote(MRState.skyMoonNoteColorCh, channels);
            MRState.arpeggioNoteVal = firstAudibleNote(MRState.arpeggioNoteColorCh, channels);
            MRState.globalNoteVal = firstAudibleNote(MRState.globalNoteColorCh, channels);
            MRState.gemCanopyNoteVal = firstAudibleNote(MRState.gemCanopyNoteColorCh, channels);
            MRState.skyIslandsNoteVal = firstAudibleNote(MRState.skyIslandsNoteColorCh, channels);
            MRState.sugarCavesNoteVal = firstAudibleNote(MRState.sugarCavesNoteColorCh, channels);

            // Push to TSL uniforms.
            // Mutate .value in place: never reassign the uniform node itself.
            // arpeggio_grove shimmer/hueShift already written by applyArpeggioGroveChannelAccum.
            // crystalline_nebula shimmer/amplitudeScale/noteColor already written by applyNebulaChannelAccum.
            BiomeUniforms.global.shimmer.value = normalizeAccum(
                MRState.globalShimmerAccum,
                MRState.globalShimmerCh,
                nightGate,
                MRState.globalIntensityScale
            );
            BiomeUniforms.global.hueShift.value = normalizeAccum(
                MRState.globalHueShiftAccum,
                MRState.globalHueShiftCh,
                nightGate,
                MRState.globalIntensityScale
            );

            BiomeUniforms.gemCanopy.shimmer.value = normalizeAccum(
                MRState.gemCanopyShimmerAccum,
                MRState.gemCanopyShimmerCh,
                nightGate,
                MRState.gemCanopyIntensityScale
            );
            BiomeUniforms.gemCanopy.hueShift.value = normalizeAccum(
                MRState.gemCanopyHueShiftAccum,
                MRState.gemCanopyHueShiftCh,
                nightGate,
                MRState.gemCanopyIntensityScale
            );

            BiomeUniforms.skyIslands.shimmer.value = normalizeAccum(
                MRState.skyIslandsShimmerAccum,
                MRState.skyIslandsShimmerCh,
                nightGate,
                MRState.skyIslandsIntensityScale
            );
            BiomeUniforms.skyIslands.hueShift.value = normalizeAccum(
                MRState.skyIslandsHueShiftAccum,
                MRState.skyIslandsHueShiftCh,
                nightGate,
                MRState.skyIslandsIntensityScale
            );

            // Sky Islands fog is the one scalar that eases towards a rest/peak
            // range rather than being driven directly.
            {
                const fogNorm = normalizeAccum(
                    MRState.skyIslandsFogAccum,
                    MRState.skyIslandsFogCh,
                    nightGate,
                    MRState.skyIslandsIntensityScale
                );
                const fogTarget =
                    MRState.skyIslandsFogRest +
                    (MRState.skyIslandsFogPeak - MRState.skyIslandsFogRest) * fogNorm;
                BiomeUniforms.skyIslands.fogDensity.value =
                    BiomeUniforms.skyIslands.fogDensity.value * 0.85 + fogTarget * 0.15;
            }

            BiomeUniforms.sugarCaves.shimmer.value = normalizeAccum(
                MRState.sugarCavesShimmerAccum,
                MRState.sugarCavesShimmerCh,
                nightGate,
                MRState.sugarCavesIntensityScale
            );
            BiomeUniforms.sugarCaves.hueShift.value = normalizeAccum(
                MRState.sugarCavesHueShiftAccum,
                MRState.sugarCavesHueShiftCh,
                nightGate,
                MRState.sugarCavesIntensityScale
            );

            BiomeUniforms.skyMoon.moonIntensity.value = normalizeAccum(
                MRState.skyMoonIntensityAccum,
                MRState.skyMoonIntensityCh,
                nightGate,
                MRState.skyMoonIntensityScale
            );

            // --- Note colours ---
            // Must run after the shimmer writes above: gem_canopy's awakening
            // check reads back the shimmer value set this frame.
            applyNoteColor(
                BiomeUniforms.skyMoon.moonNoteColor,
                MRState.skyMoonNoteVal,
                _targetMoonColor,
                'global',
                0.1
            );
            applyNoteColor(
                BiomeUniforms.arpeggioGrove.noteColor,
                MRState.arpeggioNoteVal,
                _targetArpeggioColor,
                'global',
                0.1
            );
            applyNoteColor(
                BiomeUniforms.global.noteColor,
                MRState.globalNoteVal,
                _targetGlobalColor,
                'global',
                0.1
            );

            if (
                applyNoteColor(
                    BiomeUniforms.gemCanopy.noteColor,
                    MRState.gemCanopyNoteVal,
                    _targetGemCanopyColor,
                    'gem_canopy',
                    0.12
                )
            ) {
                const shimmer = BiomeUniforms.gemCanopy.shimmer.value;
                if (shimmer > 0.2) {
                    awakenedPersistence.tryAwakenNearby(
                        'gem_canopy_tree',
                        this._lastCameraPos,
                        shimmer,
                        _targetGemCanopyColor.getHex()
                    );
                }
            }

            applyNoteColor(
                BiomeUniforms.skyIslands.noteColor,
                MRState.skyIslandsNoteVal,
                _targetSkyIslandsColor,
                'sky_islands',
                0.12
            );
            applyNoteColor(
                BiomeUniforms.sugarCaves.noteColor,
                MRState.sugarCavesNoteVal,
                _targetSugarCavesColor,
                'sugar_caves',
                0.12
            );
        } else {
            // No audio data — smoothly decay towards resting values (no snapping).
            for (let i = 0; i < SILENT_DECAY_UNIFORMS.length; i++) {
                SILENT_DECAY_UNIFORMS[i].value *= SILENT_DECAY;
            }
            // Decay amplitude towards baseline 1.0
            BiomeUniforms.crystallineNebula.amplitudeScale.value =
                1.0 + (BiomeUniforms.crystallineNebula.amplitudeScale.value - 1.0) * SILENT_DECAY;
            // NB: 0.1 literal, not (1 - SILENT_DECAY) — the latter is
            // 0.09999999999999998 and drifts this IIR off the original values.
            BiomeUniforms.skyIslands.fogDensity.value =
                BiomeUniforms.skyIslands.fogDensity.value * SILENT_DECAY +
                MRState.skyIslandsFogRest * 0.1;

            releaseNoteColor(BiomeUniforms.skyMoon.moonNoteColor, _targetMoonColor);
            releaseNoteColor(BiomeUniforms.arpeggioGrove.noteColor, _targetArpeggioColor);
            releaseNoteColor(BiomeUniforms.crystallineNebula.noteColor, _targetNebulaColor);
            releaseNoteColor(BiomeUniforms.global.noteColor, _targetGlobalColor);
            releaseNoteColor(BiomeUniforms.gemCanopy.noteColor, _targetGemCanopyColor);
            releaseNoteColor(BiomeUniforms.skyIslands.noteColor, _targetSkyIslandsColor);
            releaseNoteColor(BiomeUniforms.sugarCaves.noteColor, _targetSugarCavesColor);
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
                if (lpData.notes && lpData.notes[i] > maxAmp) {
                    maxAmp = lpData.notes[i] || 0;
                    dominantNote = i;
                }
            }

            // Add a threshold
            const targetIntensity = maxAmp > 0.1 ? maxAmp * MRState.luminousIntensityScale : 0.0;

            // 1-pole IIR smoothing (Zero-allocation)
            LuminousPlantUniforms.intensity.value +=
                (targetIntensity - LuminousPlantUniforms.intensity.value) * 0.15;

            // Only snap note index when amplitude is high enough
            if (targetIntensity > 0.2) {
                // Map chromatic note index (0-11) across 128 LUT slots exactly like sky_moon
                LuminousPlantUniforms.noteIndex.value = Math.min(
                    Math.floor((dominantNote / 12) * 128),
                    127
                );

                // Awakened persistence: first music reaction near player awakens nearby luminous plants
                const noteName = CHROMATIC_SCALE[dominantNote];
                const noteColor =
                    CONFIG.noteColorMap.luminous_plants?.[noteName] ??
                    CONFIG.noteColorMap.global?.[noteName];
                awakenedPersistence.tryAwakenNearby(
                    'luminous_plant',
                    this._lastCameraPos,
                    targetIntensity,
                    typeof noteColor === 'number' ? noteColor : undefined
                );
            }
        }
        // Day guard: clamp intensity to 0 when daytime so sky/moon are unchanged.
        SkyUniforms.intensity.value = !isDay ? Math.min(MRState.smoothedSkyIntensity, 1.0) : 0.0;
    }

    private updateSkyWavePropagation(
        audioState: AudioData | null,
        isDay: boolean,
        cameraPosition?: THREE.Vector3,
        deltaTime: number = 0.016
    ) {
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
                const elapsed =
                    (performance.now() - MRState.activeWave.timestamp) /
                    MRState.skyWavePropagationMs;
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
                    setActiveWave(null);
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
                setActiveWave(null);
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
                const raw = idx < ch.length ? ch[idx].volume * b.scale : 0;
                WeatherMusicTargets.rainIntensity = smooth(
                    WeatherMusicTargets.rainIntensity,
                    Math.min(raw, 1.0),
                    b.smoothing
                );
            }
            if (MRState.weatherBindings.thunderPulse) {
                const b = MRState.weatherBindings.thunderPulse;
                const idx = b.channel;
                const raw = idx < ch.length ? ch[idx].volume * b.scale : 0;
                WeatherMusicTargets.thunderPulse = smooth(
                    WeatherMusicTargets.thunderPulse,
                    Math.min(raw, 1.0),
                    b.smoothing
                );
            }
            if (MRState.weatherBindings.fogDensity) {
                const b = MRState.weatherBindings.fogDensity;
                const idx = b.channel;
                const raw = idx < ch.length ? ch[idx].volume * b.scale : 0;
                WeatherMusicTargets.fogDensity = smooth(
                    WeatherMusicTargets.fogDensity,
                    Math.min(raw, 1.0),
                    b.smoothing
                );
            }
        } else {
            // Feature off or no channel data — exponentially decay targets to zero.
            // Gradual decay (~200 ms time constant) prevents abrupt transitions on mid-game toggle.
            const decayFactor = 1.0 - Math.exp(-deltaTime * WEATHER_TARGET_DECAY_RATE);
            WeatherMusicTargets.rainIntensity -= WeatherMusicTargets.rainIntensity * decayFactor;
            WeatherMusicTargets.thunderPulse -= WeatherMusicTargets.thunderPulse * decayFactor;
            WeatherMusicTargets.fogDensity -= WeatherMusicTargets.fogDensity * decayFactor;
            // Clamp to zero below threshold to avoid denormals
            if (WeatherMusicTargets.rainIntensity < 0.001) WeatherMusicTargets.rainIntensity = 0;
            if (WeatherMusicTargets.thunderPulse < 0.001) WeatherMusicTargets.thunderPulse = 0;
            if (WeatherMusicTargets.fogDensity < 0.001) WeatherMusicTargets.fogDensity = 0;
        }
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

        this.updateFoliageAnimationLoop(
            time,
            deltaTime,
            audioState,
            cpuAnimatedFoliage,
            camera,
            isDay,
            isDeepNight
        );

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
