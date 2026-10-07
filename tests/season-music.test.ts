/**
 * Season shaping of the generative soundtrack
 * (src/audio/generative/season-music.ts + season-core's music modifier).
 *
 * Spring must leave every biome's sound exactly as authored; the other
 * seasons move tempo, brightness, density and reverb within safe bounds.
 * Tempo is guarded tightly because game time runs at 120 / BPM, so a season's
 * tempo also stretches the day.
 *
 * Run with: npm run test:season-music
 */

import {
    BIOME_PROFILES,
    blendProfiles,
    type BiomeMusicProfile,
} from '../src/audio/generative/biome-profiles.ts';
import {
    SEASON_BRIGHTNESS_FLOOR,
    applySeasonMusicModifier,
} from '../src/audio/generative/season-music.ts';
import { SEASON_DEFAULTS } from '../src/core/config/season.ts';
import {
    AUTUMN,
    SEASON_NAMES,
    SPRING,
    SUMMER,
    WINTER,
    blendSeasonMusicModifier,
    computeSeasonState,
    createSeasonMusicModifier,
    createSeasonState,
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

const MUSIC = SEASON_DEFAULTS.music;
const CAL = { ...SEASON_DEFAULTS, seedPhase: false };

function scratch(): BiomeMusicProfile {
    return { ...BIOME_PROFILES.global, channelDensity: [...BIOME_PROFILES.global.channelDensity] };
}

function modFor(season: number) {
    return blendSeasonMusicModifier(
        computeSeasonState(0, 1, CAL, season, createSeasonState()),
        MUSIC,
        createSeasonMusicModifier()
    );
}

function shaped(biome: string, season: number): BiomeMusicProfile {
    const out = scratch();
    blendProfiles(BIOME_PROFILES[biome], BIOME_PROFILES[biome], 1, out);
    return applySeasonMusicModifier(out, modFor(season));
}

function same(a: BiomeMusicProfile, b: BiomeMusicProfile): boolean {
    return (
        a.id === b.id &&
        a.root === b.root &&
        a.scale === b.scale &&
        a.tempo === b.tempo &&
        a.nightTempoScale === b.nightTempoScale &&
        a.brightness === b.brightness &&
        a.groove === b.groove &&
        a.mood === b.mood &&
        a.channelDensity.every((v, i) => v === b.channelDensity[i])
    );
}

console.log('\nSpring is identity');
{
    let identical = true;
    for (const biome of Object.keys(BIOME_PROFILES)) {
        const plain = scratch();
        blendProfiles(BIOME_PROFILES[biome], BIOME_PROFILES.global, 0.3, plain);
        const spring = scratch();
        blendProfiles(BIOME_PROFILES[biome], BIOME_PROFILES.global, 0.3, spring);
        applySeasonMusicModifier(spring, modFor(SPRING));
        if (!same(plain, spring)) identical = false;
    }
    check('spring leaves every biome blend bit-for-bit unchanged', identical);
    const m = modFor(SPRING);
    check(
        'spring modifier is 1, 0, 1, 0',
        m.tempoScale === 1 && m.brightnessShift === 0 && m.densityScale === 1 && m.reverbWet === 0
    );
}

console.log('\nSeasons sound different');
{
    let ok = true;
    for (const biome of Object.keys(BIOME_PROFILES)) {
        const summer = shaped(biome, SUMMER);
        const winter = shaped(biome, WINTER);
        if (!(winter.tempo < summer.tempo && winter.brightness < summer.brightness)) ok = false;
    }
    check('winter is slower and darker than summer in every biome', ok);
    check(
        'winter adds reverb, summer does not',
        modFor(WINTER).reverbWet > 0 && modFor(SUMMER).reverbWet === 0
    );
    const winterDensity = shaped('global', WINTER).channelDensity;
    const base = BIOME_PROFILES.global.channelDensity;
    check(
        'winter thins the arrangement',
        winterDensity.every((v, i) => v <= base[i]) && winterDensity.some((v, i) => v < base[i])
    );
}

console.log('\nBounds');
{
    let floorOk = true;
    let densityOk = true;
    for (const biome of Object.keys(BIOME_PROFILES)) {
        for (const season of [SPRING, SUMMER, AUTUMN, WINTER]) {
            const p = shaped(biome, season);
            const original = BIOME_PROFILES[biome].brightness;
            if (
                p.brightness < Math.min(original, SEASON_BRIGHTNESS_FLOOR) - 1e-12 ||
                p.brightness > 1
            )
                floorOk = false;
            if (p.channelDensity.some((v) => v > 1 || v < 0)) densityOk = false;
        }
    }
    check(`brightness stays in [min(biome, ${SEASON_BRIGHTNESS_FLOOR}), 1]`, floorOk);
    check('channel density stays in [0, 1]', densityOk);
    const tempos = SEASON_NAMES.map((s) => MUSIC.tempoScale[s]);
    check(
        'tempo scale stays within ±8% (it stretches the day)',
        tempos.every((t) => t >= 0.92 && t <= 1.08),
        tempos.join(', ')
    );
}

console.log('\nBlending');
{
    const out = scratch();
    const mod = modFor(WINTER);
    blendProfiles(BIOME_PROFILES.global, BIOME_PROFILES.global, 1, out);
    applySeasonMusicModifier(out, mod);
    const first = { ...out, channelDensity: [...out.channelDensity] };
    blendProfiles(BIOME_PROFILES.global, BIOME_PROFILES.global, 1, out);
    applySeasonMusicModifier(out, mod);
    check('re-applying after a fresh blend does not compound', same(first, out));

    // Halfway through the autumn → winter crossfade.
    const state = createSeasonState();
    state.weights.set([0, 0, 0.5, 0.5]);
    const half = blendSeasonMusicModifier(state, MUSIC, createSeasonMusicModifier());
    const a = modFor(AUTUMN);
    const w = modFor(WINTER);
    const between = (v: number, x: number, y: number) =>
        v >= Math.min(x, y) - 1e-12 && v <= Math.max(x, y) + 1e-12;
    check(
        'a crossfading modifier sits between its seasons',
        between(half.tempoScale, a.tempoScale, w.tempoScale) &&
            between(half.brightnessShift, a.brightnessShift, w.brightnessShift) &&
            between(half.reverbWet, a.reverbWet, w.reverbWet)
    );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
