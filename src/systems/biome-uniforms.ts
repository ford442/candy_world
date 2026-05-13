import * as THREE from 'three';
/**
 * Shared TSL uniform nodes for biome-specific music reactivity.
 *
 * These nodes are created ONCE at module-init time and mutated each frame
 * by the music-reactivity binding system — zero per-frame allocations.
 *
 * Material graphs: import BiomeUniforms and reference e.g.
 *   BiomeUniforms.arpeggioGrove.shimmer  (a TSL UniformNode<float>)
 *
 * Update loop: mutate .value only — never reassign the node itself.
 *   BiomeUniforms.arpeggioGrove.shimmer.value = 0.75;
 */

import { uniform, texture, vec2 } from 'three/tsl';
import { DataTexture, RGBAFormat, FloatType, Color, NearestFilter } from 'three';
import { CONFIG } from '../core/config.ts';

export const BiomeUniforms = {
    /**
     * Arpeggio Grove — tracker channels defined in assets/music-bindings.json
     * under "arpeggio_grove".
     */
    arpeggioGrove: {
        /** 0–1 sparkle/shimmer emissive boost driven by melody channels. */
        shimmer: uniform(0.0),
        /** 0–1 hue-mix factor — blends frond colour towards an accent tint. */
        hueShift: uniform(0.0),
    },

    /**
     * Crystalline Nebula — tracker channels defined in assets/music-bindings.json
     * under "crystalline_nebula".
     */
    crystallineNebula: {
        /** 0–1 shimmer emissive boost on lotus rings. */
        shimmer: uniform(0.0),
        /** ≥1 amplitude multiplier for the lotus bass-pulse displacement. */
        amplitudeScale: uniform(1.0),
    },

    /**
     * Sky & Moon — tracker channels defined in assets/music-bindings.json
     * under "sky_moon".
     */
    skyMoon: {
        /** RGB color for note reactivity */
        moonNoteColor: uniform(new THREE.Color(0xffffff)),
        /** 0-1 intensity based on channels */
        moonIntensity: uniform(0.0),
    },


} as const;

// ---------------------------------------------------------------------------
// Sky / Moon note-colour uniforms (Moon Dance feature)
// ---------------------------------------------------------------------------

/**
 * TSL uniforms for the note-driven sky/moon hue shift.
 * Created once at module init — mutate .value only each frame.
 *
 * noteIndex : float 0–127, maps into skyLutData; GPU normalises to UV [0,1].
 * intensity : float 0–1, mix factor between base sky/moon colour and note colour.
 *             Set to 0 during daytime so the feature has zero impact on day scenes.
 */

export const LuminousPlantUniforms = {
    /** 0-1 intensity based on channels */
    intensity: uniform(0.0),
    /** RGB color for note reactivity */
    noteColor: uniform(new THREE.Color(0xffffff)),
    /** Active note index for precise mapping (0-127) */
    noteIndex: uniform(0.0),
} as const;

export const SkyUniforms = {
    noteIndex: uniform(0.0),
    intensity: uniform(0.0),
} as const;

/**
 * 128-slot RGBA-float LUT: maps note index → hue colour.
 * Shared between GPU DataTexture (skyNoteColorNode) and CPU moon lerp.
 *
 * Uses chromatic colors mapped from CONFIG.noteColorMap.sky
 */
export const skyLutData = new Float32Array(128 * 4);
(function buildSkyLut() {
    const c = new Color();
    const CHROMATIC_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const skyMap = CONFIG.noteColorMap.sky || CONFIG.noteColorMap.global;

    for (let i = 0; i < 128; i++) {
        // Since we map 12 chromatic notes across 128 slots during reactivity updates:
        // Math.floor((chromaticIdx / 12) * 128)
        // Here we reverse it to determine which note index this slot mostly corresponds to.
        const chromaticIdx = Math.floor((i / 128) * 12);
        const noteName = CHROMATIC_SCALE[chromaticIdx];
        const hex = skyMap[noteName] || 0xffffff;

        c.setHex(hex);
        skyLutData[i * 4 + 0] = c.r;
        skyLutData[i * 4 + 1] = c.g;
        skyLutData[i * 4 + 2] = c.b;
        skyLutData[i * 4 + 3] = 1.0;
    }
})();

const _skyLutTex = new DataTexture(skyLutData, 128, 1, RGBAFormat, FloatType);
_skyLutTex.minFilter = NearestFilter;
_skyLutTex.magFilter = NearestFilter;
_skyLutTex.needsUpdate = true;

/**
 * TSL node: samples the note-colour LUT for the current SkyUniforms.noteIndex.
 * UV uses pixel-centre addressing: (noteIndex + 0.5) / 128 keeps sampling
 * strictly within the 128-slot range and avoids edge/wrap artefacts.
 * Safe to use in both the sky dome colorNode and the moon emissiveNode.
 */
export const skyNoteColorNode = texture(_skyLutTex, vec2(SkyUniforms.noteIndex.add(0.5).div(128.0), 0.5)).rgb;

/**
 * 128-slot RGBA-float LUT: maps note index -> hue colour for Luminous Plants.
 */
export const luminousPlantsLutData = new Float32Array(128 * 4);
(function buildLuminousPlantsLut() {
    const c = new Color();
    const CHROMATIC_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const plantMap = CONFIG.noteColorMap.luminous_plants || CONFIG.noteColorMap.global;

    for (let i = 0; i < 128; i++) {
        const chromaticIdx = Math.floor((i / 128) * 12);
        const noteName = CHROMATIC_SCALE[chromaticIdx];
        const hex = plantMap[noteName] || 0xffffff;

        c.setHex(hex);
        luminousPlantsLutData[i * 4 + 0] = c.r;
        luminousPlantsLutData[i * 4 + 1] = c.g;
        luminousPlantsLutData[i * 4 + 2] = c.b;
        luminousPlantsLutData[i * 4 + 3] = 1.0;
    }
})();

const _luminousPlantsLutTex = new DataTexture(luminousPlantsLutData, 128, 1, RGBAFormat, FloatType);
_luminousPlantsLutTex.minFilter = NearestFilter;
_luminousPlantsLutTex.magFilter = NearestFilter;
_luminousPlantsLutTex.needsUpdate = true;

/**
 * TSL node: samples the note-colour LUT for the current LuminousPlantUniforms.noteIndex.
 */
export const luminousPlantsNoteColorNode = texture(_luminousPlantsLutTex, vec2(LuminousPlantUniforms.noteIndex.add(0.5).div(128.0), 0.5)).rgb;
