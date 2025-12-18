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
