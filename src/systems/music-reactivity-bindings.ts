import * as THREE from 'three';
import { BiomeUniforms } from './biome-uniforms.ts';
import { awakenedPersistence } from './awakened-persistence-api.ts';
import type { AudioData, ChannelData } from '../foliage/types.ts';
import {
    MRState,
    mapNoteToColor,
    applyArpeggioGroveChannelAccum,
    applyNebulaChannelAccum,
    parseNoteToMIDI,
    _targetArpeggioColor,
    _targetNebulaColor,
    _targetGlobalColor,
    _targetGemCanopyColor,
    _targetSkyIslandsColor,
    _targetSugarCavesColor,
    _targetMoonColor
} from './music-reactivity-core.ts';
import { CHROMATIC_SCALE } from './music-reactivity-defaults.ts';
import { CONFIG } from '../core/config.ts';

/** Volume above which a channel counts as playing a note. */
export const NOTE_AUDIBLE_THRESHOLD = 0.05;
/** Per-frame lerp back towards white once a biome's note channel goes silent. */
export const NOTE_COLOR_RELEASE_LERP = 0.05;
/** Per-frame multiplier applied to reactive uniforms while audio is inactive. */
export const SILENT_DECAY = 0.9;

/** Uniforms that simply decay towards zero when there is no audio data. */
export const SILENT_DECAY_UNIFORMS = [
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
export function accumChannelVolume(chList: readonly number[], channels: readonly ChannelData[]): number {
    let sum = 0.0;
    for (let i = 0; i < chList.length; i++) {
        const idx = chList[i];
        if (idx < channels.length) sum += channels[idx].volume;
    }
    return sum;
}

/** Note value of the first configured channel that is audible; 0 if none is. */
export function firstAudibleNote(chList: readonly number[], channels: readonly ChannelData[]): number {
    for (let i = 0; i < chList.length; i++) {
        const idx = chList[i];
        if (idx < channels.length && channels[idx].volume > NOTE_AUDIBLE_THRESHOLD) {
            return parseNoteToMIDI(channels[idx].note);
        }
    }
    return 0;
}

/** Channel accumulator → 0..1 uniform value, day/night gated and map scaled. */
export function normalizeAccum(
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
export function releaseNoteColor(uniform: { value: THREE.Color }, target: THREE.Color) {
    target.setHex(0xffffff);
    uniform.value.lerp(target, NOTE_COLOR_RELEASE_LERP);
}

/**
 * Lerp a biome's noteColor uniform towards the colour of the note it is
 * playing, or release it towards white when silent. Returns true if a note was
 * playing, so callers can hang biome-specific behaviour off a note hit.
 */
export function applyNoteColor(
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

export function updateBiomeChannelBindings(audioState: AudioData | null, dayNightBias: number, _lastCameraPos: THREE.Vector3) {
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
                        _lastCameraPos,
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