import { DURATION_SUNRISE, DURATION_DAY, DURATION_SUNSET } from '../core/config.ts';

/**
 * How a rain front looks at this time of day: mist just after sunrise, drizzle
 * through sunset, plain rain otherwise. Weather fronts decide *whether* it rains
 * (weather/weather-fronts-core.ts); this only picks the fog and particle flavour
 * read by WeatherAtmosphere.updateFog and WeatherEffects.updateParticleSystems.
 * Allocation-free, unlike the per-frame bias object it replaces.
 */
export function rainFlavour(cyclePos: number): 'mist' | 'drizzle' | 'rain' {
    if (cyclePos < DURATION_SUNRISE + 60) return 'mist';
    const sunsetStart = DURATION_SUNRISE + DURATION_DAY;
    if (cyclePos > sunsetStart && cyclePos < sunsetStart + DURATION_SUNSET + 60) return 'drizzle';
    return 'rain';
}
