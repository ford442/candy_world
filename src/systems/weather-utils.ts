import { WeatherState } from './weather-types.ts';
import {
    DURATION_SUNRISE,
    DURATION_DAY,
    DURATION_SUNSET,
    DURATION_DUSK_NIGHT,
    CYCLE_DURATION
} from '../core/config.ts';

export function calculateTimeOfDayBias(cyclePos: number, randomVal: number = Math.random()): { biasState: WeatherState, biasIntensity: number, type: string } {
    const SUNRISE = DURATION_SUNRISE;
    const DAY = DURATION_DAY;
    const SUNSET = DURATION_SUNSET;
    // DUSK_NIGHT is the transition to deep night

    // 1. Morning Mist (Sunrise to +60s)
    if (cyclePos < SUNRISE + 60) {
        const progress = Math.max(0, cyclePos / (SUNRISE + 60));
        return {
            biasState: WeatherState.RAIN,
            biasIntensity: 0.3 * (1.0 - progress),
            type: 'mist'
        };
    }

    // 2. Afternoon Storms (Mid-Day: ~300s to ~450s)
    // Day is 60s to 480s. Mid-day is ~270s.
    // Let's target "afternoon" specifically.
    const afternoonStart = SUNRISE + (DAY * 0.6); // ~312s
    const afternoonEnd = SUNRISE + DAY - 30;      // ~450s

    if (cyclePos > afternoonStart && cyclePos < afternoonEnd) {
        // Low probability check per frame (assuming 60fps, 0.0005 is ~3% chance per second)
        // randomVal allows deterministic testing
        if (randomVal < 0.0005) {
             return {
                 biasState: WeatherState.STORM,
                 biasIntensity: 0.8 + (randomVal * 100) * 0.2, // Use randomVal for variety if convenient, or Math.random
                 type: 'thunderstorm'
             };
        }
    }

    // 3. Evening Drizzle (Sunset to early Dusk)
    const sunsetStart = SUNRISE + DAY;
    const drizzleEnd = sunsetStart + SUNSET + 60; // Sunset + 1 min into dusk

    if (cyclePos > sunsetStart && cyclePos < drizzleEnd) {
         // Ramp up intensity during sunset, peak at transition
         let intensity = 0.4;
         if (cyclePos < sunsetStart + SUNSET) {
             intensity = 0.2 + 0.2 * ((cyclePos - sunsetStart) / SUNSET);
         }
         return {
             biasState: WeatherState.RAIN,
             biasIntensity: intensity,
             type: 'drizzle'
         };
    }

    // 4. Clear Night (Bias towards CLEAR to show stars)
    // Any time not covered above defaults to CLEAR, but explicit check for night is good documentation.

    return {
        biasState: WeatherState.CLEAR,
        biasIntensity: 0,
        type: 'clear'
    };
}
