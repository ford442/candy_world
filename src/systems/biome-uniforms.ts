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

import { uniform } from 'three/tsl';

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
        /** 0–1 intensity based on channels */
        moonIntensity: uniform(0.0),
    },
} as const;
