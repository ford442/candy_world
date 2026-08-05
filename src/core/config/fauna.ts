import type { ConfigType } from './types.ts';

/** Ambient fauna (boids + instanced critters). */
export const FAUNA_DEFAULTS: ConfigType['fauna'] = {
    enabled: true,
    maxInstances: 96,
    maxPerSpecies: 40,
    seed: 42,
    areaScale: 1.0,
    biomeDensity: {
        arpeggio_grove: { beetle: 8, hopper: 6, moth: 4 },
        crystalline_nebula: { beetle: 4, hopper: 3, moth: 10 },
        luminous_plants: { beetle: 5, hopper: 4, moth: 8 },
        gem_canopy: { beetle: 6, hopper: 5, moth: 3 },
        lake_features: { beetle: 3, hopper: 2, moth: 5 },
        sky_islands: { beetle: 2, hopper: 2, moth: 9 },
        global: { beetle: 5, hopper: 4, moth: 4 },
    },
    roosts: {
        enabled: true,
        perIsland: 4,
        ringInset: 0.55,
        jitter: 0.12,
        density: { beetle: 1, hopper: 1, moth: 8 },
    },
};
