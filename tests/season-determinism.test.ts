/**
 * Presence peers agree on the world's season, weather and lake without talking.
 *
 * A presence room is `candy:${seed}`, and the season, the weather fronts and
 * the lake ice are pure functions of (seed, wall clock). Two peers whose
 * clocks differ by a couple of seconds and who joined at different times must
 * therefore see the same world, except within that skew of a transition.
 *
 * Run with: npm run test:season-determinism
 */

import { SEASON_DEFAULTS } from '../src/core/config/season.ts';
import {
    SEASON_ROLE_STRIDE,
    SEASON_ROLES,
    blendSeasonPalette,
    computeSeasonState,
    createSeasonState,
    prepareSeasonPalette,
    virtualSeasonClock,
} from '../src/systems/season-core.ts';
import {
    createWeatherFrontSample,
    sampleWeatherFront,
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

const CFG = SEASON_DEFAULTS;
const SKEW_MS = 2000;
const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 7);
const prepared = prepareSeasonPalette(CFG.palette);

let rng = 0x1234;
function rand(): number {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
}

/** What one peer sees at its own clock. */
function peerView(nowMs: number, seed: number) {
    const state = computeSeasonState(nowMs, seed, CFG, -1, createSeasonState());
    const params = new Float32Array(SEASON_ROLES.length * SEASON_ROLE_STRIDE);
    blendSeasonPalette(state, prepared, params);
    const front = sampleWeatherFront(nowMs, seed, CFG, CFG.weather, -1, createWeatherFrontSample());
    return {
        season: state.current,
        params,
        frozen: state.frost >= CFG.lake.freezeAt,
        front: front.type,
        intensity: front.intensity,
    };
}

console.log('\nTwo peers, one room');
{
    const seed = 424242;
    const SAMPLES = 4000;
    let seasonMismatch = 0;
    let seasonMismatchNearEdge = 0;
    let worstPalette = 0;
    let frontMismatch = 0;
    let frontMismatchNearEdge = 0;
    let worstIntensity = 0;
    let lakeMismatch = 0;
    let lakeMismatchNearEdge = 0;

    for (let i = 0; i < SAMPLES; i++) {
        const t = START + rand() * 8 * DAY;
        const skew = (rand() * 2 - 1) * SKEW_MS;
        const a = peerView(t, seed);
        const b = peerView(t + skew, seed);
        // "Near an edge": the answer changes somewhere between the two clocks.
        const lo = Math.min(t, t + skew);
        const hi = Math.max(t, t + skew);
        const edge = (f: (v: ReturnType<typeof peerView>) => unknown) =>
            f(peerView(lo, seed)) !== f(peerView(hi, seed));

        if (a.season !== b.season) {
            seasonMismatch++;
            if (edge((v) => v.season)) seasonMismatchNearEdge++;
        }
        for (let k = 0; k < a.params.length; k++)
            worstPalette = Math.max(worstPalette, Math.abs(a.params[k] - b.params[k]));
        if (a.front !== b.front) {
            frontMismatch++;
            if (edge((v) => v.front)) frontMismatchNearEdge++;
        }
        worstIntensity = Math.max(worstIntensity, Math.abs(a.intensity - b.intensity));
        if (a.frozen !== b.frozen) {
            lakeMismatch++;
            if (edge((v) => v.frozen)) lakeMismatchNearEdge++;
        }
    }

    check(
        'peers agree on the season except across a boundary inside their skew',
        seasonMismatch === seasonMismatchNearEdge,
        `${seasonMismatch} mismatches`
    );
    check(
        'palette differs by at most a sliver over 2 s of skew',
        worstPalette < 1e-3,
        `worst ${worstPalette.toExponential(2)}`
    );
    check(
        'peers agree on the front except across a change inside their skew',
        frontMismatch === frontMismatchNearEdge,
        `${frontMismatch} mismatches`
    );
    check(
        'front intensity differs by at most a sliver',
        worstIntensity < 0.02,
        `worst ${worstIntensity.toFixed(4)}`
    );
    check(
        'peers agree on the lake except across a freeze or thaw inside their skew',
        lakeMismatch === lakeMismatchNearEdge,
        `${lakeMismatch} mismatches`
    );
    check('mismatches are rare', seasonMismatch + frontMismatch + lakeMismatch < SAMPLES * 0.01);
}

console.log('\nJoin time does not matter');
{
    const now = START + 1.3 * DAY;
    const earlyJoiner = virtualSeasonClock(now, now - 3 * DAY, 1);
    const lateJoiner = virtualSeasonClock(now, now - 5_000, 1);
    check(
        'the real calendar ignores when a peer loaded',
        earlyJoiner === lateJoiner && earlyJoiner === now
    );
    const a = peerView(earlyJoiner, 9);
    const b = peerView(lateJoiner, 9);
    check(
        'so both peers see the same world',
        a.season === b.season && a.front === b.front && a.frozen === b.frozen
    );
}

console.log('\nRooms differ');
{
    const now = START + 2.2 * DAY;
    const seasons = new Set<number>();
    const fronts = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
        const v = peerView(now, seed);
        seasons.add(v.season);
        fronts.add(`${v.season}:${v.front}`);
    }
    check(
        'different rooms sit in different seasons at the same moment',
        seasons.size >= 3,
        `${seasons.size} seasons over 60 seeds`
    );
    check(
        'and see different weather',
        fronts.size >= 5,
        `${fronts.size} season/front combinations`
    );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
