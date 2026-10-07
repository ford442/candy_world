/**
 * Weather fronts: multi-slot weather as a pure function of (seed, wall-clock ms).
 *
 * Time is cut into wall-clock slots (default 20 min, about 1¼ game days).
 * Each slot hashes to a front — clear, rain or storm, with a peak intensity —
 * drawn from the odds of the season at the slot's midpoint. The first minutes
 * of every slot ramp from the previous slot's front, and neighbouring slots of
 * the same type merge into one long front, so weather builds, holds and
 * clears instead of flickering frame to frame.
 *
 * Like the season, it needs no saving and no networking: every peer with the
 * same seed computes the same sky. Music may nudge intensity but never the
 * front's type (docs/SEASONS.md, "Weather fronts").
 */
import {
    SEASON_NAMES,
    computeSeasonState,
    createSeasonState,
    hash32,
    type SeasonCalendarConfig,
    type SeasonName,
} from '../season-core.ts';

export const FRONT_CLEAR = 0;
export const FRONT_RAIN = 1;
export const FRONT_STORM = 2;

/** Relative odds of each front type in one season (normalised when sampled). */
export interface FrontOdds {
    clear: number;
    rain: number;
    storm: number;
}

export interface WeatherFrontConfig {
    /** Wall-clock minutes per front slot. */
    slotMinutes: number;
    /** Minutes at the start of each slot spent ramping from the previous front. */
    rampMinutes: number;
    /** How far music may push intensity either way. */
    musicIntensityRange: number;
    /** Peak intensity range for rain and storm fronts. */
    rainIntensity: { min: number; max: number };
    stormIntensity: { min: number; max: number };
    odds: Record<SeasonName, FrontOdds>;
}

/** Where a front is in its life, for announcements and debugging. */
export const FRONT_PHASES = [
    'clear',
    'arriving',
    'rain',
    'building',
    'storm',
    'easing',
    'clearing',
] as const;
export type FrontPhase = (typeof FRONT_PHASES)[number];

export interface WeatherFrontSample {
    /** FRONT_CLEAR | FRONT_RAIN | FRONT_STORM. */
    type: number;
    /** 0..1; exactly 0 when clear. */
    intensity: number;
    /** Index into FRONT_PHASES. */
    phase: number;
    slot: number;
    /** 0..1 through the ramp at the start of the slot; 1 once settled. */
    ramp: number;
}

export function createWeatherFrontSample(): WeatherFrontSample {
    return { type: FRONT_CLEAR, intensity: 0, phase: 0, slot: 0, ramp: 1 };
}

const SALT_TYPE = 0xf407;
const SALT_PEAK = 0x9ea4;
const MINUTE_MS = 60_000;

const _slotSeason = createSeasonState();
// Scratch for the two slots a sample needs: [type, peak] for slot k-1 and k.
const _front = new Float64Array(4);

function unit(seed: number, slot: number, salt: number): number {
    return hash32(seed, slot, salt) / 4294967296;
}

/** Front type and peak intensity for one slot, written to `_front[off..off+1]`. */
function frontForSlot(
    slot: number,
    seed: number,
    cal: SeasonCalendarConfig,
    wcfg: WeatherFrontConfig,
    pinned: number,
    off: number
): void {
    const slotMs = Math.max(wcfg.slotMinutes, 1) * MINUTE_MS;
    computeSeasonState(cal.epochMs + (slot + 0.5) * slotMs, seed, cal, pinned, _slotSeason);
    let clear = 0;
    let rain = 0;
    let storm = 0;
    for (let s = 0; s < 4; s++) {
        const w = _slotSeason.weights[s];
        if (w === 0) continue;
        const odds = wcfg.odds[SEASON_NAMES[s]];
        clear += w * odds.clear;
        rain += w * odds.rain;
        storm += w * odds.storm;
    }
    const roll = unit(seed, slot, SALT_TYPE) * (clear + rain + storm);
    const peakRoll = unit(seed, slot, SALT_PEAK);
    if (roll < clear) {
        _front[off] = FRONT_CLEAR;
        _front[off + 1] = 0;
    } else if (roll < clear + rain) {
        _front[off] = FRONT_RAIN;
        _front[off + 1] =
            wcfg.rainIntensity.min + (wcfg.rainIntensity.max - wcfg.rainIntensity.min) * peakRoll;
    } else {
        _front[off] = FRONT_STORM;
        _front[off + 1] =
            wcfg.stormIntensity.min +
            (wcfg.stormIntensity.max - wcfg.stormIntensity.min) * peakRoll;
    }
}

function smooth01(t: number): number {
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    return c * c * (3 - 2 * c);
}

/**
 * Weather at `nowMs`. `pinned` is a season index (or -1), so a pinned season
 * also pins the front odds. Allocation-free.
 */
export function sampleWeatherFront(
    nowMs: number,
    seed: number,
    cal: SeasonCalendarConfig,
    wcfg: WeatherFrontConfig,
    pinned: number,
    out: WeatherFrontSample
): WeatherFrontSample {
    const slotMs = Math.max(wcfg.slotMinutes, 1) * MINUTE_MS;
    const sinceEpoch = nowMs - cal.epochMs;
    const slot = Math.floor(sinceEpoch / slotMs);
    const rampMs = Math.min(Math.max(wcfg.rampMinutes, 0) * MINUTE_MS, slotMs);
    const ramp = rampMs > 0 ? smooth01((sinceEpoch - slot * slotMs) / rampMs) : 1;

    frontForSlot(slot - 1, seed, cal, wcfg, pinned, 0);
    frontForSlot(slot, seed, cal, wcfg, pinned, 2);
    const prevType = _front[0];
    const prevPeak = _front[1];
    const type = _front[2];
    const peak = _front[3];

    let outType: number;
    let intensity: number;
    let phase: FrontPhase;
    if (type === prevType) {
        outType = type;
        intensity = prevPeak + (peak - prevPeak) * ramp;
        phase = type === FRONT_CLEAR ? 'clear' : type === FRONT_RAIN ? 'rain' : 'storm';
    } else if (prevType === FRONT_CLEAR) {
        outType = type;
        intensity = peak * ramp;
        phase = ramp < 1 ? 'arriving' : type === FRONT_RAIN ? 'rain' : 'storm';
    } else if (type === FRONT_CLEAR) {
        outType = ramp < 1 ? prevType : FRONT_CLEAR;
        intensity = prevPeak * (1 - ramp);
        phase = ramp < 1 ? 'clearing' : 'clear';
    } else {
        // Rain ↔ storm: intensity slides, the type flips halfway through the ramp.
        outType = ramp < 0.5 ? prevType : type;
        intensity = prevPeak + (peak - prevPeak) * ramp;
        if (ramp >= 1) phase = type === FRONT_RAIN ? 'rain' : 'storm';
        else phase = type === FRONT_STORM ? 'building' : 'easing';
    }

    out.type = outType;
    out.intensity = outType === FRONT_CLEAR ? 0 : intensity;
    out.phase = FRONT_PHASES.indexOf(phase);
    out.slot = slot;
    out.ramp = ramp;
    return out;
}

/**
 * Music's say over a front: push intensity by `drive` (−1..1) × `range`, never
 * changing the type. Clear stays exactly 0; an active front never drops
 * below a light drizzle so music can't make it vanish.
 */
export function applyMusicIntensity(base: number, drive: number, range: number): number {
    if (base <= 0) return 0;
    const d = drive < -1 ? -1 : drive > 1 ? 1 : drive;
    const v = base + d * range;
    return v < 0.05 ? 0.05 : v > 1 ? 1 : v;
}

/**
 * Music drive from the audio frame: −1 (quiet) .. 1 (heavy bass and groove),
 * 0 with no audio, so a silent session leaves the fronts as scheduled.
 */
export function musicDrive(bass: number, groove: number, hasAudio: boolean): number {
    if (!hasAudio) return 0;
    const v = bass * 1.2 + groove * 0.6 - 0.6;
    return v < -1 ? -1 : v > 1 ? 1 : v;
}

export interface WeatherTarget {
    type: number;
    intensity: number;
}

/**
 * What the weather should be this frame. An explicit override (debug, visual
 * regression) wins outright; otherwise the front sets the type and music
 * nudges the intensity within it.
 */
export function resolveWeatherTarget(
    overrideType: number,
    overrideIntensity: number,
    front: WeatherFrontSample,
    drive: number,
    range: number,
    out: WeatherTarget
): WeatherTarget {
    if (overrideType >= 0) {
        out.type = overrideType;
        out.intensity = overrideType === FRONT_CLEAR ? 0 : overrideIntensity;
        return out;
    }
    out.type = front.type;
    out.intensity = applyMusicIntensity(front.intensity, drive, range);
    return out;
}

/** Spoken cue when a front enters each phase (FRONT_PHASES order); null says nothing. */
export const FRONT_ANNOUNCEMENTS: readonly (string | null)[] = [
    null,
    'Clouds are gathering.',
    null,
    'A storm is building.',
    'The storm breaks.',
    'The storm is easing.',
    'The skies are clearing.',
];
