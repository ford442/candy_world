import type { ConfigType } from './types.ts';

/** Player eye height and ground-follow tuning (#1265). */
export const PLAYER_DEFAULTS: ConfigType['player'] = {
    eyeHeight: 1.8,
    spawnEyeHeightY: 5.0,
};

/** Ground sampling, footprint radii, and camera follow smoothing. */
export const GROUND_DEFAULTS: ConfigType['ground'] = {
    followLerpSpeed: 12.0,
    followMaxStep: 2.5,
    platformElevationThreshold: 1.25,
    cacheCellSize: 2.0,
    cacheTTL: 1.0,
    footprintSamples: 4,
    maxSlopeAngle: (25 * Math.PI) / 180,
    footprintRadius: {
        tree: 0.4,
        shrub: 0.4,
        portamento_pine: 0.5,
        bubble_willow: 0.6,
        balloon_bush: 0.6,
        helix_plant: 0.4,
        gem_canopy_tree: 0.6,
        subwoofer_lotus: 0.7,
        kick_drum_geyser: 0.5,
        snare_trap: 0.5,
        instrument_shrine: 0.6,
        panning_pad: 0.5,
        mushroom: 0.25,
        retrigger_mushroom: 0.35,
        glass_mushroom: 0.25,
        rock: 0.3,
        grass: 0.15,
    },
    footprintPlacementY: {
        panning_pad: 'avg',
        subwoofer_lotus: 'avg',
    },
};
