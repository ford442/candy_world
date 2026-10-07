/**
 * Season calendar, blend and tint math (src/systems/season-core.ts).
 *
 * The season is a pure function of (seed, wall-clock ms), so presence peers
 * agree without talking; spring must leave every authored colour untouched;
 * and the palette must stay inside the candy guardrails (no greys).
 *
 * Run with: npm run test:season
 */

import { SEASON_DEFAULTS } from '../src/core/config/season.ts';
import {
    AUTUMN,
    SEASON_NAMES,
    SEASON_ROLE_INDEX,
    SEASON_ROLE_STRIDE,
    SEASON_ROLES,
    SPRING,
    SUMMER,
    WINTER,
    LUMA_B,
    LUMA_G,
    LUMA_R,
    blendSeasonPalette,
    blendSeasonScalar,
    computeSeasonState,
    computeYearProgress,
    createSeasonState,
    frostCoverage,
    parseSeasonName,
    prepareSeasonPalette,
    srgbHexToLinear,
    tintRgbInPlace,
    virtualSeasonClock,
    type SeasonCalendarConfig,
    type SeasonState,
} from '../src/systems/season-core.ts';

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

const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 2, 20);
const CAL: SeasonCalendarConfig = {
    enabled: true,
    realDaysPerSeason: 1,
    epochMs: EPOCH,
    seedPhase: false,
    transitionFraction: 0.25,
};

function stateAt(nowMs: number, seed = 12345, cal = CAL, pinned = -1): SeasonState {
    return computeSeasonState(nowMs, seed, cal, pinned, createSeasonState());
}

const prepared = prepareSeasonPalette(SEASON_DEFAULTS.palette);
const ROLE_FLOATS = SEASON_ROLES.length * SEASON_ROLE_STRIDE;

// ---------------------------------------------------------------------------
section('Calendar');
{
    const names = [0.5, 1.5, 2.5, 3.5, 4.5].map(
        (d) => SEASON_NAMES[stateAt(EPOCH + d * DAY).current]
    );
    check(
        'one real day per season, wrapping after four',
        names.join() === 'spring,summer,autumn,winter,spring',
        names.join()
    );
    const slow = { ...CAL, realDaysPerSeason: 2 };
    check(
        'realDaysPerSeason stretches the calendar',
        stateAt(EPOCH + 3 * DAY, 1, slow).current === SUMMER
    );
    check(
        'before the epoch still wraps into [0,1)',
        (() => {
            const yp = computeYearProgress(EPOCH - 0.5 * DAY, 1, CAL);
            return yp >= 0 && yp < 1 && stateAt(EPOCH - 0.5 * DAY).current === WINTER;
        })()
    );
    const off = stateAt(EPOCH + 0.5 * DAY, 7, { ...CAL, enabled: false });
    check(
        'disabled calendar pins spring',
        off.current === SPRING && off.blend === 0 && off.pinned === SPRING
    );
}

// ---------------------------------------------------------------------------
section('Peers and seeds');
{
    const now = Date.UTC(2026, 9, 7, 13, 37);
    const seeded = { ...CAL, seedPhase: true };
    const a = stateAt(now, 424242, seeded);
    const b = stateAt(now, 424242, seeded);
    const same =
        a.yearProgress === b.yearProgress &&
        a.current === b.current &&
        a.blend === b.blend &&
        a.weights.every((w, i) => w === b.weights[i]);
    check('two peers with the same seed and clock get the same state', same);

    const seasons = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) seasons.add(stateAt(now, seed, seeded).current);
    check(
        'different seeds land in different seasons',
        seasons.size >= 3,
        `${seasons.size} distinct seasons over 40 seeds`
    );

    const unphased = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) unphased.add(stateAt(now, seed, CAL).current);
    check('without seedPhase every seed shares the calendar', unphased.size === 1);
}

// ---------------------------------------------------------------------------
section('Blend window');
{
    const atBoundary = stateAt(EPOCH + 1 * DAY);
    check(
        'blend is exactly 0.5 on a boundary, spring → summer',
        atBoundary.blend === 0.5 && atBoundary.from === SPRING && atBoundary.to === SUMMER,
        `blend ${atBoundary.blend}, ${atBoundary.from} → ${atBoundary.to}`
    );
    const mid = stateAt(EPOCH + 0.5 * DAY);
    check(
        'no blend mid-season',
        mid.blend === 0 && mid.from === mid.to && mid.weights[SPRING] === 1
    );

    // Window is ±12.5% of a season around the boundary.
    let monotone = true;
    let prev = -1;
    for (let t = -0.125; t <= 0.125 + 1e-9; t += 0.005) {
        const w = stateAt(EPOCH + (1 + t) * DAY).weights[SUMMER];
        if (w < prev - 1e-6) monotone = false;
        prev = w;
    }
    check('summer weight rises monotonically through the window', monotone);
    const edgeIn = stateAt(EPOCH + (1 - 0.125) * DAY);
    const edgeOut = stateAt(EPOCH + (1 + 0.125) * DAY);
    check(
        'window edges are pure seasons',
        edgeIn.weights[SPRING] > 0.999 && edgeOut.weights[SUMMER] > 0.999
    );

    let sumsToOne = true;
    for (let d = 0; d < 4; d += 0.01) {
        const w = stateAt(EPOCH + d * DAY).weights;
        if (Math.abs(w[0] + w[1] + w[2] + w[3] - 1) > 1e-6) sumsToOne = false;
    }
    check('weights always sum to 1', sumsToOne);
}

// ---------------------------------------------------------------------------
section('Frost and sun');
{
    check(
        'no frost at mid-spring or mid-summer',
        stateAt(EPOCH + 0.5 * DAY).frost === 0 && stateAt(EPOCH + 1.5 * DAY).frost === 0
    );
    check('full frost at mid-winter', stateAt(EPOCH + 3.5 * DAY).frost === 1);
    check(
        'sun inclination peaks at midsummer',
        Math.abs(stateAt(0, 1, CAL, SUMMER).sunInclination - 1) < 1e-12
    );
    check(
        'sun inclination bottoms out at midwinter',
        Math.abs(stateAt(0, 1, CAL, WINTER).sunInclination) < 1e-12
    );
}

// ---------------------------------------------------------------------------
section('Overrides');
{
    check(
        'parseSeasonName is case- and space-insensitive',
        parseSeasonName(' Autumn ') === AUTUMN && parseSeasonName('WINTER') === WINTER
    );
    check(
        'unknown names are rejected',
        parseSeasonName('fall') === -1 && parseSeasonName('') === -1 && parseSeasonName(null) === -1
    );
    check('prototype keys are rejected', parseSeasonName('toString') === -1);
    const pinned = stateAt(EPOCH + 1 * DAY, 9, CAL, WINTER);
    check(
        'a pinned season sits at its midpoint with no blend',
        pinned.current === WINTER &&
            pinned.blend === 0 &&
            pinned.yearProgress === 0.875 &&
            pinned.frost === 1
    );
    check(
        'out-of-range pins fall back to the calendar',
        stateAt(EPOCH + 0.5 * DAY, 9, CAL, 7).pinned === -1
    );
    check('seasonSpeed 1 is the real clock', virtualSeasonClock(123456789, 1000, 1) === 123456789);
    check('seasonSpeed scales time since load', virtualSeasonClock(2000, 1000, 10) === 11000);
}

// ---------------------------------------------------------------------------
section('Spring is identity');
{
    const params = new Float32Array(ROLE_FLOATS);
    blendSeasonPalette(stateAt(0, 1, CAL, SPRING), prepared, params);
    let neutral = true;
    for (let r = 0; r < SEASON_ROLES.length; r++) {
        const o = r * SEASON_ROLE_STRIDE;
        if (params[o + 3] !== 0 || params[o + 4] !== 0 || params[o + 5] !== 1) neutral = false;
    }
    check('spring blends to amount 0, frost 0, chroma 1 for every role', neutral);

    const frost = new Float32Array(3);
    srgbHexToLinear(SEASON_DEFAULTS.frostColor, frost, 0);
    const rgb = new Float32Array(3);
    let exact = true;
    let seed = 1;
    const rand = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    for (let i = 0; i < 5000 && exact; i++) {
        const r = Math.fround(rand());
        const g = Math.fround(rand());
        const b = Math.fround(rand());
        rgb[0] = r;
        rgb[1] = g;
        rgb[2] = b;
        const role = i % SEASON_ROLES.length;
        tintRgbInPlace(rgb, 0, params, role * SEASON_ROLE_STRIDE, frost, rand() * 2 - 1);
        if (rgb[0] !== r || rgb[1] !== g || rgb[2] !== b) exact = false;
    }
    check('spring tint returns the authored colour bit for bit', exact);
}

// ---------------------------------------------------------------------------
section('Tint and blend');
{
    const autumn = new Float32Array(ROLE_FLOATS);
    blendSeasonPalette(stateAt(0, 1, CAL, AUTUMN), prepared, autumn);
    const leaf = SEASON_ROLE_INDEX.leaf * SEASON_ROLE_STRIDE;
    const targetLum = LUMA_R * autumn[leaf] + LUMA_G * autumn[leaf + 1] + LUMA_B * autumn[leaf + 2];
    check(
        'blended targets are normalised to luminance 1',
        Math.abs(targetLum - 1) < 1e-5,
        `${targetLum}`
    );

    // Amount 1, chroma 1, no frost: hue moves, luminance stays.
    const full = new Float32Array(autumn);
    full[leaf + 3] = 1;
    full[leaf + 4] = 0;
    full[leaf + 5] = 1;
    const noFrost = new Float32Array([1, 1, 1]);
    const rgb = new Float32Array([0.05, 0.3, 0.12]);
    const before = LUMA_R * rgb[0] + LUMA_G * rgb[1] + LUMA_B * rgb[2];
    tintRgbInPlace(rgb, 0, full, leaf, noFrost, 1);
    const after = LUMA_R * rgb[0] + LUMA_G * rgb[1] + LUMA_B * rgb[2];
    check('tint preserves luminance', Math.abs(after - before) < 1e-4, `${before} → ${after}`);
    check(
        'tint moves the hue toward butterscotch (red now leads green)',
        rgb[0] > rgb[1] && rgb[1] > rgb[2]
    );

    // Premultiplied: half spring + half autumn = autumn hue at half the amount.
    const half = createSeasonState();
    half.weights.set([0.5, 0, 0.5, 0]);
    const mixed = new Float32Array(ROLE_FLOATS);
    blendSeasonPalette(half, prepared, mixed);
    const sameHue =
        Math.abs(mixed[leaf] - autumn[leaf]) < 1e-5 &&
        Math.abs(mixed[leaf + 1] - autumn[leaf + 1]) < 1e-5 &&
        Math.abs(mixed[leaf + 2] - autumn[leaf + 2]) < 1e-5;
    check('spring→autumn midpoint keeps the autumn hue', sameHue);
    check(
        'spring→autumn midpoint has half the autumn amount',
        Math.abs(mixed[leaf + 3] - 0.5 * SEASON_DEFAULTS.palette.autumn.leaf.amount) < 1e-6
    );

    const winter = new Float32Array(ROLE_FLOATS);
    blendSeasonPalette(stateAt(0, 1, CAL, WINTER), prepared, winter);
    const ground = SEASON_ROLE_INDEX.ground * SEASON_ROLE_STRIDE;
    const frostRgb = new Float32Array(3);
    srgbHexToLinear(SEASON_DEFAULTS.frostColor, frostRgb, 0);
    const up = new Float32Array([0.2, 0.4, 0.1]);
    const side = new Float32Array([0.2, 0.4, 0.1]);
    tintRgbInPlace(up, 0, winter, ground, frostRgb, 1);
    tintRgbInPlace(side, 0, winter, ground, frostRgb, 0);
    check('frost settles on top faces, not sides', up[0] > side[0] && up[2] > side[2]);
    check(
        'frost coverage tops out at 80%',
        Math.abs(frostCoverage(1) - 0.8) < 1e-12 && frostCoverage(0) === 0
    );

    const scalar = blendSeasonScalar(half, { spring: 1, summer: 5, autumn: 3, winter: 9 });
    check('blendSeasonScalar weights each season', Math.abs(scalar - 2) < 1e-12);
}

// ---------------------------------------------------------------------------
section('Palette guardrails (docs/CANDY_AESTHETIC_GUARDRAILS.md)');
{
    const hsl = (hex: number): { h: number; s: number; l: number; chroma: number } => {
        const r = ((hex >> 16) & 0xff) / 255;
        const g = ((hex >> 8) & 0xff) / 255;
        const b = (hex & 0xff) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        const chroma = max - min;
        const s = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * l - 1));
        return { h: 0, s, l, chroma };
    };
    const bad: string[] = [];
    const checkColour = (label: string, hex: number): void => {
        const c = hsl(hex);
        if (c.s < 0.25 || c.chroma < 0.04 || c.l < 0.4 || c.l > 0.95) {
            bad.push(
                `${label} #${hex.toString(16)} (s ${c.s.toFixed(2)}, l ${c.l.toFixed(2)}, chroma ${c.chroma.toFixed(2)})`
            );
        }
    };
    checkColour('frostColor', SEASON_DEFAULTS.frostColor);
    let rangesOk = true;
    let springIdentity = true;
    for (const season of SEASON_NAMES) {
        for (const role of SEASON_ROLES) {
            const paint = SEASON_DEFAULTS.palette[season][role];
            checkColour(`${season}.${role}`, paint.color);
            if (
                paint.amount < 0 ||
                paint.amount > 1 ||
                paint.frost < 0 ||
                paint.frost > 1 ||
                paint.chroma < 1
            ) {
                rangesOk = false;
            }
            if (
                season === 'spring' &&
                (paint.amount !== 0 || paint.frost !== 0 || paint.chroma !== 1)
            ) {
                springIdentity = false;
            }
        }
    }
    check(
        'every palette colour is a saturated pastel, never grey',
        bad.length === 0,
        bad.join('; ')
    );
    check('amount and frost stay in 0..1 and chroma never desaturates', rangesOk);
    check('spring palette is the identity', springIdentity);
}

// ---------------------------------------------------------------------------
section('Allocation');
{
    const gc = (globalThis as { gc?: () => void }).gc;
    const state = createSeasonState();
    const params = new Float32Array(ROLE_FLOATS);
    const frost = new Float32Array([1, 1, 1]);
    const rgb = new Float32Array([0.3, 0.5, 0.2]);
    const seeded = { ...CAL, seedPhase: true };
    const ITERATIONS = 100_000;
    const step = (i: number): void => {
        computeSeasonState(EPOCH + i * 60_000, 77, seeded, -1, state);
        blendSeasonPalette(state, prepared, params);
        tintRgbInPlace(rgb, 0, params, (i % 6) * SEASON_ROLE_STRIDE, frost, 0.5);
    };
    for (let i = 0; i < 2000; i++) step(i);
    gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < ITERATIONS; i++) step(i);
    gc?.();
    const perTick = (process.memoryUsage().heapUsed - before) / ITERATIONS;
    if (gc) {
        check(
            'per-frame season update allocates nothing measurable',
            perTick < 1,
            `${perTick.toFixed(3)} bytes/tick`
        );
    } else {
        console.log(
            `  … ${perTick.toFixed(2)} bytes/tick (run with --expose-gc for the strict check)`
        );
        check(
            'per-frame season update allocation stayed bounded',
            perTick < 50,
            `${perTick.toFixed(2)} bytes/tick`
        );
    }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
