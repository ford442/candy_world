/**
 * Weather fronts (src/systems/weather/weather-fronts-core.ts).
 *
 * Fronts replace the per-frame weather picker: deterministic per seed so
 * presence peers share a sky, continuous across slot boundaries, weighted by
 * season, and only nudged (never flipped) by music.
 *
 * Run with: npm run test:weather-fronts
 */

import { SEASON_DEFAULTS } from '../src/core/config/season.ts';
import {
    AUTUMN,
    SPRING,
    SUMMER,
    WINTER,
    type SeasonCalendarConfig,
} from '../src/systems/season-core.ts';
import {
    FRONT_ANNOUNCEMENTS,
    FRONT_CLEAR,
    FRONT_PHASES,
    FRONT_RAIN,
    FRONT_STORM,
    applyMusicIntensity,
    createWeatherFrontSample,
    musicDrive,
    resolveWeatherTarget,
    sampleWeatherFront,
    type WeatherFrontSample,
} from '../src/systems/weather/weather-fronts-core.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
    if (cond) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

function section(name: string): void {
    console.log(`\n${name}`);
}

const MIN = 60_000;
const CAL: SeasonCalendarConfig = { ...SEASON_DEFAULTS, seedPhase: false };
const W = SEASON_DEFAULTS.weather;
const SLOT = W.slotMinutes * MIN;
const START = CAL.epochMs + 100 * SLOT;

function at(nowMs: number, seed = 4242, pinned = -1): WeatherFrontSample {
    return sampleWeatherFront(nowMs, seed, CAL, W, pinned, createWeatherFrontSample());
}

// ---------------------------------------------------------------------------
section('Determinism');
{
    let same = true;
    for (let i = 0; i < 500; i++) {
        const t = START + i * 37_000;
        const a = at(t, 99);
        const b = at(t, 99);
        if (a.type !== b.type || a.intensity !== b.intensity || a.phase !== b.phase) same = false;
    }
    check('two peers with the same seed and clock see the same weather', same);

    let differs = 0;
    for (let i = 0; i < 200; i++) {
        const t = START + i * SLOT + SLOT / 2;
        if (at(t, 1).type !== at(t, 2).type) differs++;
    }
    check('different seeds get different weather', differs > 40, `${differs}/200 slots differ`);
}

// ---------------------------------------------------------------------------
section('Continuity');
{
    let worst = 0;
    let clearNonZero = 0;
    let prev = at(START);
    for (let t = START + 1000; t < START + 40 * SLOT; t += 1000) {
        const s = at(t);
        worst = Math.max(worst, Math.abs(s.intensity - prev.intensity));
        if (s.type === FRONT_CLEAR && s.intensity !== 0) clearNonZero++;
        prev = s;
    }
    // Largest legal step: a full 0→1 ramp over rampMinutes, sampled each second, peaks at 1.5× the mean slope.
    const bound = (1.5 * 1000) / (W.rampMinutes * MIN) + 1e-9;
    check(
        'intensity never jumps between one-second samples',
        worst <= bound,
        `worst step ${worst.toFixed(5)} (bound ${bound.toFixed(5)})`
    );
    check(
        'clear always means intensity 0',
        clearNonZero === 0,
        `${clearNonZero} clear samples with intensity`
    );

    // Mid-slot samples are settled: ramp done, type equals the slot's own front.
    const mid = at(START + 7 * SLOT + SLOT / 2);
    check('weather is settled once the ramp ends', mid.ramp === 1);
}

// ---------------------------------------------------------------------------
section('Seasons weight the fronts');
{
    const N = 10_000;
    const share = (pinned: number): { clear: number; rain: number; storm: number } => {
        const c = [0, 0, 0];
        for (let i = 0; i < N; i++) c[at(START + i * SLOT + SLOT / 2, 77, pinned).type]++;
        return { clear: c[0] / N, rain: c[1] / N, storm: c[2] / N };
    };
    const norm = (o: { clear: number; rain: number; storm: number }) => {
        const t = o.clear + o.rain + o.storm;
        return { clear: o.clear / t, rain: o.rain / t, storm: o.storm / t };
    };
    const shares = [SPRING, SUMMER, AUTUMN, WINTER].map(share);
    const odds = [W.odds.spring, W.odds.summer, W.odds.autumn, W.odds.winter].map(norm);
    let within = true;
    let worst = 0;
    for (let s = 0; s < 4; s++) {
        for (const k of ['clear', 'rain', 'storm'] as const) {
            const d = Math.abs(shares[s][k] - odds[s][k]);
            worst = Math.max(worst, d);
            if (d > 0.02) within = false;
        }
    }
    check(
        'front shares match the configured odds per season',
        within,
        `worst deviation ${worst.toFixed(4)}`
    );
    check('summer storms more than winter', shares[1].storm > shares[3].storm);
    check('spring rains more than summer', shares[0].rain > shares[1].rain);
}

// ---------------------------------------------------------------------------
section('Fronts last');
{
    // Run length in slots, counted on settled mid-slot samples.
    let runs = 0;
    let total = 0;
    let prevType = -1;
    for (let i = 0; i < 5000; i++) {
        const type = at(START + i * SLOT + SLOT / 2).type;
        if (type !== prevType) runs++;
        prevType = type;
        total++;
    }
    const mean = total / runs;
    check(
        'fronts last more than one slot on average',
        mean > 1.2,
        `mean run ${mean.toFixed(2)} slots`
    );

    // Flicker check: within one settled slot the type never changes.
    let flips = 0;
    const base = START + 300 * SLOT;
    for (let i = 0; i < 300; i++) {
        let last = -1;
        for (let t = W.rampMinutes * MIN; t < SLOT; t += 30_000) {
            const type = at(base + i * SLOT + t).type;
            if (last !== -1 && type !== last) flips++;
            last = type;
        }
    }
    check('no flicker inside a settled slot', flips === 0, `${flips} flips`);
}

// ---------------------------------------------------------------------------
section('Phases');
{
    const seen = new Set<string>();
    for (let t = START; t < START + 2000 * SLOT; t += SLOT / 8) seen.add(FRONT_PHASES[at(t).phase]);
    for (const p of FRONT_PHASES) check(`phase "${p}" occurs`, seen.has(p));

    let wrongArriving = 0;
    let wrongClearing = 0;
    for (let t = START; t < START + 2000 * SLOT; t += SLOT / 8) {
        const s = at(t);
        const phase = FRONT_PHASES[s.phase];
        if (phase === 'arriving' && (s.type === FRONT_CLEAR || s.ramp >= 1)) wrongArriving++;
        if (phase === 'clearing' && s.ramp >= 1) wrongClearing++;
    }
    check('"arriving" only while a front ramps in', wrongArriving === 0);
    check('"clearing" only while a front ramps out', wrongClearing === 0);
}

// ---------------------------------------------------------------------------
section('Music');
{
    const r = W.musicIntensityRange;
    let bounded = true;
    for (let b = 0.05; b <= 1; b += 0.05) {
        for (let d = -1; d <= 1; d += 0.1) {
            const v = applyMusicIntensity(b, d, r);
            if (Math.abs(v - b) > r + 1e-9 && v !== 0.05 && v !== 1) bounded = false;
        }
    }
    check(`music moves intensity by at most ±${r}`, bounded);
    check('music never brings rain to a clear sky', applyMusicIntensity(0, 1, r) === 0);
    check('music never stops an active front', applyMusicIntensity(0.1, -1, r) === 0.05);
    check('no audio is neutral', musicDrive(1, 1, false) === 0);
    check('heavy bass and groove push up', musicDrive(1, 1, true) > 0.5);
    check('silence in a playing track pulls down', musicDrive(0, 0, true) < 0);
    check(
        'a pinned season pins the odds',
        (() => {
            let storms = 0;
            for (let i = 0; i < 2000; i++)
                if (at(START + i * SLOT + SLOT / 2, 5, WINTER).type === FRONT_STORM) storms++;
            return (
                Math.abs(
                    storms / 2000 -
                        W.odds.winter.storm /
                            (W.odds.winter.clear + W.odds.winter.rain + W.odds.winter.storm)
                ) < 0.03
            );
        })()
    );
    check(
        'rain fronts sit in their configured range',
        (() => {
            for (let i = 0; i < 2000; i++) {
                const s = at(START + i * SLOT + SLOT / 2);
                if (
                    s.type === FRONT_RAIN &&
                    (s.intensity < W.rainIntensity.min || s.intensity > W.rainIntensity.max)
                )
                    return false;
                if (
                    s.type === FRONT_STORM &&
                    (s.intensity < W.stormIntensity.min || s.intensity > W.stormIntensity.max)
                )
                    return false;
            }
            return true;
        })()
    );
}

// ---------------------------------------------------------------------------
section('Precedence');
{
    const target = { type: -1, intensity: -1 };
    const front = createWeatherFrontSample();
    front.type = FRONT_RAIN;
    front.intensity = 0.5;
    resolveWeatherTarget(FRONT_STORM, 0.9, front, 1, 0.2, target);
    check(
        'an override beats the front and music',
        target.type === FRONT_STORM && target.intensity === 0.9
    );
    resolveWeatherTarget(FRONT_CLEAR, 0.9, front, 1, 0.2, target);
    check('a clear override is intensity 0', target.type === FRONT_CLEAR && target.intensity === 0);
    resolveWeatherTarget(-1, 0, front, 1, 0.2, target);
    check('without an override the front sets the type', target.type === FRONT_RAIN);
    check('and music nudges its intensity', Math.abs(target.intensity - 0.7) < 1e-12);
    check(
        'every phase has an announcement slot',
        FRONT_ANNOUNCEMENTS.length === FRONT_PHASES.length &&
            FRONT_ANNOUNCEMENTS[FRONT_PHASES.indexOf('clear')] === null &&
            typeof FRONT_ANNOUNCEMENTS[FRONT_PHASES.indexOf('clearing')] === 'string'
    );
}

// ---------------------------------------------------------------------------
section('Allocation');
{
    const gc = (globalThis as { gc?: () => void }).gc;
    const out = createWeatherFrontSample();
    const ITERATIONS = 100_000;
    for (let i = 0; i < 2000; i++) sampleWeatherFront(START + i * 1000, 3, CAL, W, -1, out);
    gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < ITERATIONS; i++) sampleWeatherFront(START + i * 1000, 3, CAL, W, -1, out);
    gc?.();
    const perTick = (process.memoryUsage().heapUsed - before) / ITERATIONS;
    if (gc) {
        check(
            'sampling a front allocates nothing measurable',
            perTick < 1,
            `${perTick.toFixed(3)} bytes/tick`
        );
    } else {
        console.log(
            `  … ${perTick.toFixed(2)} bytes/tick (run with --expose-gc for the strict check)`
        );
        check('sampling a front stayed bounded', perTick < 50, `${perTick.toFixed(2)} bytes/tick`);
    }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
