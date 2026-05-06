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
export const SkyUniforms = {
    noteIndex: uniform(0.0),
    intensity: uniform(0.0),
} as const;

/**
 * 128-slot RGBA-float LUT: maps note index → HSL hue colour.
 * Shared between GPU DataTexture (skyNoteColorNode) and CPU moon lerp.
 *
 * Slot i  →  HSL(i/128, 0.9, 0.5)
 */
export const skyLutData = new Float32Array(128 * 4);
(function buildSkyLut() {
    const c = new Color();
    for (let i = 0; i < 128; i++) {
        c.setHSL(i / 128, 0.9, 0.5);
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
