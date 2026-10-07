import * as THREE from 'three';
import {
    PALETTE, CYCLE_DURATION, DURATION_SUNRISE, DURATION_DAY,
    DURATION_SUNSET, DURATION_DUSK_NIGHT, DURATION_DEEP_NIGHT, DURATION_PRE_DAWN,
    PaletteEntry
} from './config.ts';

// --- Reusable Color Pool for Render Loop (prevents GC pressure) ---
export const _scratchPalette: PaletteEntry = {
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

export function lerpPalette(p1: PaletteEntry, p2: PaletteEntry, t: number): PaletteEntry {
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
export function getCycleState(tRaw: number, paletteMode: string = 'standard'): PaletteEntry {
    const t = tRaw % CYCLE_DURATION;

    // Determine target palettes based on mode
    let targetDay = PALETTE.day;
    let targetSunset = PALETTE.sunset;
    let targetNight = PALETTE.night;
    let targetSunrise = PALETTE.sunrise;

    if (paletteMode === 'neon') {
        targetDay = PALETTE.neon; // Neon Day
        // We could define neon_sunset etc, but for now reuse or mix
        targetSunset = PALETTE.sunset;
        targetNight = PALETTE.neon; // Neon Night is same as Day for intense look
        targetSunrise = PALETTE.neon;
    } else if (paletteMode === 'glitch') {
        targetDay = PALETTE.glitch;
        targetSunset = PALETTE.glitch;
        targetNight = PALETTE.glitch;
        targetSunrise = PALETTE.glitch;
    }

    // 1. Sunrise (0-60)
    if (t < DURATION_SUNRISE) {
        return lerpPalette(targetNight, targetSunrise, t / DURATION_SUNRISE);
    }

    let elapsed = DURATION_SUNRISE;

    // 2. Day (60-480)
    if (t < elapsed + DURATION_DAY) {
        const localT = t - elapsed;
        if (localT < 60) return lerpPalette(targetSunrise, targetDay, localT / 60);
        return targetDay;
    }
    elapsed += DURATION_DAY;

    // 3. Sunset (480-540)
    if (t < elapsed + DURATION_SUNSET) {
        const localT = t - elapsed;
        return lerpPalette(targetDay, targetSunset, localT / DURATION_SUNSET);
    }
    elapsed += DURATION_SUNSET;

    // 4. Dusk Night (540-720)
    if (t < elapsed + DURATION_DUSK_NIGHT) {
        const localT = t - elapsed;
        // Fade to Night
        if (localT < 60) return lerpPalette(targetSunset, targetNight, localT / 60);
        return targetNight;
    }
    elapsed += DURATION_DUSK_NIGHT;

    // 5. Deep Night (720-840)
    if (t < elapsed + DURATION_DEEP_NIGHT) {
        return targetNight;
    }
    elapsed += DURATION_DEEP_NIGHT;

    // 6. Pre-Dawn (840-960)
    if (t < elapsed + DURATION_PRE_DAWN) {
        return targetNight;
    }

    return targetNight; // Fallback
}


// --- NEW: Helper to get celestial intensities ---
export function getCelestialState(tRaw: number, out?: { sunIntensity: number; moonIntensity: number }): { sunIntensity: number; moonIntensity: number } {
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

    if (out) {
        out.sunIntensity = sunIntensity;
        out.moonIntensity = moonIntensity;
        return out;
    }

    return { sunIntensity, moonIntensity };
}


/**
 * Returns a continuous day/night bias scalar for the plant pose state machine.
 *
 * - 1.0  → full day   (sunrise end → sunset start)
 * - 0.0  → full night (post-sunset → pre-sunrise)
 * - Smoothly interpolated during sunrise and sunset transitions.
 *
 * No heap allocations — pure arithmetic on the cycle position.
 */
export function getDayNightBias(cyclePos: number): number {
    const t = getCyclePos(cyclePos);
    // Sunrise: ramp 0 → 1
    if (t < DURATION_SUNRISE) return t / DURATION_SUNRISE;
    // Day: full brightness
    const dayEnd = DURATION_SUNRISE + DURATION_DAY;
    if (t < dayEnd) return 1.0;
    // Sunset: ramp 1 → 0
    if (t < NIGHT_START) return 1.0 - (t - dayEnd) / DURATION_SUNSET;
    // Night
    return 0.0;
}

/** Cycle position (s) where night begins: the end of sunset. */
export const NIGHT_START = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET;
/** Cycle position (s) where deep night begins; deep night and pre-dawn run to the wrap. */
export const DEEP_NIGHT_START = NIGHT_START + DURATION_DUSK_NIGHT;

/**
 * Wrap world time (s) into [0, CYCLE_DURATION). Every phase test must go through
 * this: summing the phase durations by hand is how the visuals loop once ended up
 * wrapping at 840 s while the palette and day/night bias wrapped at 960 s.
 */
export function getCyclePos(t: number): number {
    const p = t % CYCLE_DURATION;
    return p < 0 ? p + CYCLE_DURATION : p;
}

/** True from the end of sunset until the wrap back to sunrise. */
export function isNightCyclePos(cyclePos: number): boolean {
    return cyclePos >= NIGHT_START;
}

/** True through deep night and pre-dawn (the last stretch before sunrise). */
export function isDeepNight(cyclePos: number): boolean {
    return cyclePos >= DEEP_NIGHT_START;
}

// The sun crosses the horizon halfway through sunrise and halfway through sunset,
// so the time-of-day presets (dawn 30 s, sunset 510 s) frame a low sun.
const SUN_RISE_POS = DURATION_SUNRISE / 2;
const SUN_SET_POS = NIGHT_START - DURATION_SUNSET / 2;
const SUN_DAY_ARC = SUN_SET_POS - SUN_RISE_POS;

/**
 * Sun elevation angle (radians) for a cycle position: 0 at sunrise on the
 * horizon, π/2 at noon, π at sunset, and through (π, 2π) below the horizon all
 * night. `sin()` of the result is the sun's height.
 */
export function getSunArcAngle(cyclePos: number): number {
    const p = getCyclePos(cyclePos);
    if (p >= SUN_RISE_POS && p < SUN_SET_POS) {
        return (Math.PI * (p - SUN_RISE_POS)) / SUN_DAY_ARC;
    }
    const intoNight = getCyclePos(p - SUN_SET_POS);
    return Math.PI + (Math.PI * intoNight) / (CYCLE_DURATION - SUN_DAY_ARC);
}

// Moon cycle = 8 game days. Seasons now run on a wall-clock calendar
// (systems/season-core.ts); the moon stays on game time because night darkness
// and fog read it every frame.
const MOON_CYCLE_LENGTH = CYCLE_DURATION * 8;

/** Moon phase for world time: 0 = new, 1 = full (at the cycle midpoint). */
export function getMoonPhase(tRaw: number): number {
    const p = tRaw % MOON_CYCLE_LENGTH;
    const moonProgress = (p < 0 ? p + MOON_CYCLE_LENGTH : p) / MOON_CYCLE_LENGTH;
    return 1.0 - Math.abs(moonProgress - 0.5) * 2.0;
}
