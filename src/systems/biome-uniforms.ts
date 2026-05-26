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
import { DataTexture, RGBAFormat, HalfFloatType, Color, NearestFilter, DataUtils } from 'three';
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
        noteColor: uniform(new THREE.Color(0xffffff)),
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
        noteColor: uniform(new THREE.Color(0xffffff)),
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

    /**
     * Global — screen-wide or ambient effects (e.g. chromatic pulse overlay).
     */
    global: {
        /** 0–1 shimmer emissive boost for global effects. */
        shimmer: uniform(0.0),
        /** 0–1 hue-mix factor for global color shifts. */
        hueShift: uniform(0.0),
        noteColor: uniform(new THREE.Color(0xffffff)),
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
 */const CHROMATIC_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const skyLutData = new Float32Array(128 * 4);

(function buildSkyLut() {
    const c = new Color();

    // Use configurable note colors from CONFIG (preferred)
    // Falls back to the old rainbow if CONFIG.noteColorMap is not available
    const noteColorMap = CONFIG?.noteColorMap?.global || {};

    for (let i = 0; i < 128; i++) {
        const chromaticIdx = Math.floor((i * 12) / 128);
        const pitchClass = chromaticIdx % 12;
        const noteName = CHROMATIC_SCALE[pitchClass];

        const hexColor = noteColorMap[noteName] || 0xFFFFFF;

        c.setHex(hexColor);

        skyLutData[i * 4 + 0] = c.r;
        skyLutData[i * 4 + 1] = c.g;
        skyLutData[i * 4 + 2] = c.b;
        skyLutData[i * 4 + 3] = 1.0;
    }
})();

// r32float textures are non-filterable in WebGPU — Three.js falls back to
// textureLoad(...) without the required mip-level argument, causing a WGSL
// parse error.  HalfFloatType (r16float) IS filterable, so Three.js can use
// textureSample instead.  The same fix is applied in ground-heightmap.ts.
const _skyLutHalf = new Uint16Array(128 * 4);
for (let i = 0; i < 128 * 4; i++) _skyLutHalf[i] = DataUtils.toHalfFloat(skyLutData[i]);
const _skyLutTex = new DataTexture(_skyLutHalf, 128, 1, RGBAFormat, HalfFloatType);
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

const _luminousPlantsLutHalf = new Uint16Array(128 * 4);
for (let i = 0; i < 128 * 4; i++) _luminousPlantsLutHalf[i] = DataUtils.toHalfFloat(luminousPlantsLutData[i]);
const _luminousPlantsLutTex = new DataTexture(_luminousPlantsLutHalf, 128, 1, RGBAFormat, HalfFloatType);
_luminousPlantsLutTex.minFilter = NearestFilter;
_luminousPlantsLutTex.magFilter = NearestFilter;
_luminousPlantsLutTex.needsUpdate = true;

/**
 * TSL node: samples the note-colour LUT for the current LuminousPlantUniforms.noteIndex.
 */
export const luminousPlantsNoteColorNode = texture(_luminousPlantsLutTex, vec2(LuminousPlantUniforms.noteIndex.add(0.5).div(128.0), 0.5)).rgb;

// ---------------------------------------------------------------------------
// Biome tagging & uniform lookup (foundational for scalable music reactivity)
// ---------------------------------------------------------------------------

/**
 * Lightweight biome identifier.
 * Used to tag foliage objects and to look up the correct uniform group without
 * hard-coded imports everywhere.
 *
 * Add new values here + corresponding entry in BiomeUniforms (or alias) when
 * introducing a new musical biome.
 */
export type BiomeId = 'arpeggio_grove' | 'crystalline_nebula' | 'luminous_plants' | 'sky_moon' | 'global';

/**
 * Returns the appropriate uniform group for a given biome tag.
 * Falls back to arpeggioGrove for unknown / unset values (safe default).
 *
 * Usage in batchers / material graphs:
 *   const uniforms = getBiomeUniforms(biome);
 *   ... uniforms.noteColor ...
 *
 * This makes adding a third (or Nth) biome cheap and prevents wiring drift.
 */
export function getBiomeUniforms(biome: BiomeId | string | undefined) {
    switch (biome) {
        case 'arpeggio_grove':
            return BiomeUniforms.arpeggioGrove;
        case 'crystalline_nebula':
            return BiomeUniforms.crystallineNebula;
        case 'luminous_plants':
            // Luminous primarily uses its own LuminousPlantUniforms for intensity/noteIndex,
            // but we expose the noteColor here for wave / shared tinting use cases.
            return {
                ...BiomeUniforms.arpeggioGrove, // shape compatibility if someone expects the common fields
                noteColor: LuminousPlantUniforms.noteColor as any,
                // intensity / noteIndex live on LuminousPlantUniforms directly
            } as any;
        case 'sky_moon':
            // Sky/Moon uses different key names internally; alias them to the common shape.
            return {
                shimmer: BiomeUniforms.skyMoon.moonIntensity as any,
                hueShift: uniform(0.0),
                noteColor: BiomeUniforms.skyMoon.moonNoteColor as any,
            };
        case 'global':
            return BiomeUniforms.global;
        default:
            return BiomeUniforms.arpeggioGrove;
    }
}

/** Convenience re-export of the type for consumers that only need the id. */
export type { BiomeId as BiomeTag };
