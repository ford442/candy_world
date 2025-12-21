// src/core/cycle.js

import * as THREE from 'three';
import {
    PALETTE, CYCLE_DURATION, DURATION_SUNRISE, DURATION_DAY,
    DURATION_SUNSET, DURATION_DUSK_NIGHT, DURATION_DEEP_NIGHT, DURATION_PRE_DAWN
} from './config.js';

// --- Reusable Color Pool for Render Loop (prevents GC pressure) ---
export const _scratchPalette = {
    skyTop: new THREE.Color(),
    skyBot: new THREE.Color(),
    horizon: new THREE.Color(),
    fog: new THREE.Color(),
    sun: new THREE.Color(),
    amb: new THREE.Color(),
    sunInt: 0,
    ambInt: 0,
    atmosphereIntensity: 0
};

export function lerpPalette(p1, p2, t) {
    _scratchPalette.skyTop.copy(p1.skyTop).lerp(p2.skyTop, t);
    _scratchPalette.skyBot.copy(p1.skyBot).lerp(p2.skyBot, t);
    _scratchPalette.horizon.copy(p1.horizon).lerp(p2.horizon, t);
    _scratchPalette.fog.copy(p1.fog).lerp(p2.fog, t);
    _scratchPalette.sun.copy(p1.sun).lerp(p2.sun, t);
    _scratchPalette.amb.copy(p1.amb).lerp(p2.amb, t);
    _scratchPalette.sunInt = THREE.MathUtils.lerp(p1.sunInt, p2.sunInt, t);
    _scratchPalette.ambInt = THREE.MathUtils.lerp(p1.ambInt, p2.ambInt, t);
    _scratchPalette.atmosphereIntensity = THREE.MathUtils.lerp(p1.atmosphereIntensity, p2.atmosphereIntensity, t);
    return _scratchPalette;
}

// --- Cycle Interpolation ---
export function getCycleState(tRaw) {
    const t = tRaw % CYCLE_DURATION;

    // 1. Sunrise (0-60)
    if (t < DURATION_SUNRISE) {
        return lerpPalette(PALETTE.night, PALETTE.sunrise, t / DURATION_SUNRISE);
    }

    let elapsed = DURATION_SUNRISE;

    // 2. Day (60-480)
    if (t < elapsed + DURATION_DAY) {
        const localT = t - elapsed;
        if (localT < 60) return lerpPalette(PALETTE.sunrise, PALETTE.day, localT / 60);
        return PALETTE.day;
    }
    elapsed += DURATION_DAY;

    // 3. Sunset (480-540)
    if (t < elapsed + DURATION_SUNSET) {
        const localT = t - elapsed;
        return lerpPalette(PALETTE.day, PALETTE.sunset, localT / DURATION_SUNSET);
    }
    elapsed += DURATION_SUNSET;

    // 4. Dusk Night (540-720)
    if (t < elapsed + DURATION_DUSK_NIGHT) {
        const localT = t - elapsed;
        // Fade to Night
        if (localT < 60) return lerpPalette(PALETTE.sunset, PALETTE.night, localT / 60);
        return PALETTE.night;
    }
    elapsed += DURATION_DUSK_NIGHT;

    // 5. Deep Night (720-840)
    if (t < elapsed + DURATION_DEEP_NIGHT) {
        return PALETTE.night;
    }
    elapsed += DURATION_DEEP_NIGHT;

    // 6. Pre-Dawn (840-960)
    if (t < elapsed + DURATION_PRE_DAWN) {
        return PALETTE.night;
    }

    return PALETTE.night; // Fallback
}


// --- NEW: Helper to get celestial intensities ---
export function getCelestialState(tRaw) {
    const t = tRaw % CYCLE_DURATION;
    const SUNRISE_END = DURATION_SUNRISE;
    const SUNSET_START = DURATION_SUNRISE + DURATION_DAY;
    const SUNSET_END = SUNSET_START + DURATION_SUNSET;

    let sunIntensity = 0;
    let moonIntensity = 0;

    // Day Logic
    if (t >= SUNRISE_END && t <= SUNSET_START) {
        sunIntensity = 1.0;
        moonIntensity = 0.0;
    } else if (t < SUNRISE_END) {
        // Sunrise: Sun fades in, Moon fades out
        sunIntensity = t / DURATION_SUNRISE;
        moonIntensity = 1.0 - sunIntensity;
    } else if (t > SUNSET_START && t < SUNSET_END) {
        // Sunset: Sun fades out, Moon fades in
        const fade = (t - SUNSET_START) / DURATION_SUNSET;
        sunIntensity = 1.0 - fade;
        moonIntensity = fade;
    } else {
        // Night
        sunIntensity = 0.0;
        moonIntensity = 1.0;
    }

    return { sunIntensity, moonIntensity };
}


// --- NEW: Seasonal & Yearly Calculations ---

// Year = 40 Days (10 days per season)
const YEAR_LENGTH = CYCLE_DURATION * 40; // 40 in-game days per year
// Moon cycle = 8 days so it slowly drifts against the 10-day seasons
const MOON_CYCLE_LENGTH = CYCLE_DURATION * 8; // Full moon every 8 days

export function getSeasonalState(tRaw) {
    // 1. Calculate Year Progress (0.0 to 1.0)
    // 0.0 = Spring Start
    // 0.25 = Summer Start
    // 0.5 = Autumn Start
    // 0.75 = Winter Start
    const yearProgress = (tRaw % YEAR_LENGTH) / YEAR_LENGTH;
    
    let season = 'Spring';
    if (yearProgress > 0.75) season = 'Winter';
    else if (yearProgress > 0.5) season = 'Autumn';
    else if (yearProgress > 0.25) season = 'Summer';

    // 2. Calculate Sun Inclination (Declination)
    // Summer (0.25) = Highest (+23.5 deg equiv), Winter (0.75) = Lowest (-23.5 deg equiv)
    // We map this to a factor 0.0 (Winter) to 1.0 (Summer)
    // Sine wave peaks at 0.25 (Summer Solstice)
    const sunInclination = (Math.sin((yearProgress * Math.PI * 2) - (Math.PI / 2)) * 0.5) + 0.5;

    // 3. Calculate Moon Phase
    // 0.0 = New Moon, 0.5 = Full Moon, 1.0 = New Moon
    const moonProgress = (tRaw % MOON_CYCLE_LENGTH) / MOON_CYCLE_LENGTH;
    
    // Simple visual phase (0 = Empty, 1 = Full)
    // Full at 0.5
    const moonPhase = 1.0 - Math.abs(moonProgress - 0.5) * 2.0;

    return {
        season,
        sunInclination, // 0.0 (Low/Winter) to 1.0 (High/Summer)
        moonPhase,      // 0.0 (New) to 1.0 (Full)
        yearProgress
    };
}
