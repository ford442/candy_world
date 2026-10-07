import type { SeasonMusicModifier } from '../../systems/season-core.ts';
import type { BiomeMusicProfile } from './biome-profiles.ts';

/** Seasons may darken the filter, but never below this unless the biome itself is darker. */
export const SEASON_BRIGHTNESS_FLOOR = 0.2;

/**
 * Shape a freshly blended biome profile for the season, in place (docs/SEASONS.md).
 * Call it on the crossfade scratch right after `blendProfiles`, so it never
 * compounds. Each field is untouched at its identity value, so spring leaves
 * the biome's sound exactly as authored.
 */
export function applySeasonMusicModifier(
    profile: BiomeMusicProfile,
    mod: Readonly<SeasonMusicModifier>
): BiomeMusicProfile {
    if (mod.tempoScale !== 1) profile.tempo *= mod.tempoScale;
    if (mod.brightnessShift !== 0) {
        const floor = Math.min(profile.brightness, SEASON_BRIGHTNESS_FLOOR);
        profile.brightness = Math.min(1, Math.max(floor, profile.brightness + mod.brightnessShift));
    }
    if (mod.densityScale !== 1) {
        const density = profile.channelDensity as number[];
        for (let i = 0; i < density.length; i++) {
            density[i] = Math.min(1, density[i] * mod.densityScale);
        }
    }
    return profile;
}
