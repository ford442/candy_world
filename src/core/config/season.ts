import type { ConfigType } from './types.ts';

/**
 * Seasons (docs/SEASONS.md). The calendar runs on wall-clock time from the
 * world seed, so everyone in a presence room shares a season.
 *
 * Palette rules (docs/CANDY_AESTHETIC_GUARDRAILS.md, "Seasonal albedo moves"):
 * spring is the identity season, every colour stays a saturated pastel
 * (tests/season-core.test.ts enforces the floor), `chroma` never drops below 1,
 * and frost is a tinted cream, never white or grey.
 */
export const SEASON_DEFAULTS: ConfigType['season'] = {
    enabled: true,
    realDaysPerSeason: 1,
    // Spring equinox 2026, 00:00 UTC.
    epochMs: Date.UTC(2026, 2, 20),
    seedPhase: true,
    transitionFraction: 0.25,
    // Pink-lilac powdered sugar.
    frostColor: 0xf7eaf6,
    // Visual Impact: front odds set how much of the year is wet. Today's audio
    // picker rained whenever the bass did; fronts leave roughly half the year clear.
    weather: {
        slotMinutes: 20,
        rampMinutes: 4,
        musicIntensityRange: 0.2,
        rainIntensity: { min: 0.35, max: 0.75 },
        stormIntensity: { min: 0.75, max: 1.0 },
        odds: {
            // Frequent short showers.
            spring: { clear: 0.45, rain: 0.45, storm: 0.1 },
            // Long clear spells broken by thunderstorms.
            summer: { clear: 0.55, rain: 0.15, storm: 0.3 },
            autumn: { clear: 0.55, rain: 0.35, storm: 0.1 },
            // Steady, gentle precipitation; storms are rare.
            winter: { clear: 0.55, rain: 0.4, storm: 0.05 },
        },
    },
    windGustScale: { spring: 1.0, summer: 0.85, autumn: 1.5, winter: 1.15 },
    fauna: {
        flockScale: { spring: 1, summer: 0.9, autumn: 0.75, winter: 0.45 },
        settleScale: { spring: 1, summer: 1, autumn: 1.2, winter: 3 },
        settleDurationScale: { spring: 1, summer: 1, autumn: 1, winter: 2.5 },
        // Autumn moths drift toward the sky-island roosts.
        migration: { spring: 0, summer: 0, autumn: 0.6, winter: 0 },
    },
    spawnScale: {
        berries: { spring: 1, summer: 0.85, autumn: 0.7, winter: 0.3 },
        gemFruit: { spring: 1, summer: 0.8, autumn: 1, winter: 0.35 },
        fireflies: { spring: 1, summer: 1, autumn: 0.5, winter: 0.15 },
        dandelionSeeds: { spring: 1, summer: 0.7, autumn: 0.4, winter: 0.2 },
    },
    music: {
        // Game time runs at 120/BPM, so tempo also stretches the day; keep within ±8%.
        tempoScale: { spring: 1, summer: 1.03, autumn: 0.97, winter: 0.93 },
        brightnessShift: { spring: 0, summer: 0.08, autumn: -0.08, winter: -0.15 },
        densityScale: { spring: 1, summer: 1.1, autumn: 0.9, winter: 0.75 },
        reverbWet: { spring: 0, summer: 0, autumn: 0.12, winter: 0.3 },
    },
    luminousBoost: { spring: 1, summer: 0.9, autumn: 1.1, winter: 1.4 },
    palette: {
        spring: {
            leaf: { color: 0x7ce87c, amount: 0, frost: 0, chroma: 1 },
            petal: { color: 0xff8fc8, amount: 0, frost: 0, chroma: 1 },
            cap: { color: 0xff8f8f, amount: 0, frost: 0, chroma: 1 },
            ground: { color: 0x9be36a, amount: 0, frost: 0, chroma: 1 },
            bark: { color: 0xb0745e, amount: 0, frost: 0, chroma: 1 },
            water: { color: 0x4fd3ff, amount: 0, frost: 0, chroma: 1 },
        },
        // Saturated candy: the authored colours, louder, leaves a touch fresher.
        summer: {
            leaf: { color: 0x6fe07a, amount: 0.1, frost: 0, chroma: 1.2 },
            petal: { color: 0xff6fb5, amount: 0, frost: 0, chroma: 1.25 },
            cap: { color: 0xff7a7a, amount: 0, frost: 0, chroma: 1.15 },
            ground: { color: 0x9be36a, amount: 0.15, frost: 0, chroma: 1.1 },
            bark: { color: 0xb0745e, amount: 0, frost: 0, chroma: 1.05 },
            water: { color: 0x4fd3ff, amount: 0.15, frost: 0, chroma: 1.15 },
        },
        // Butterscotch and plum.
        autumn: {
            leaf: { color: 0xf2a541, amount: 0.55, frost: 0, chroma: 1 },
            petal: { color: 0xc774c9, amount: 0.35, frost: 0, chroma: 1 },
            cap: { color: 0xe3955a, amount: 0.3, frost: 0, chroma: 1 },
            ground: { color: 0xd9a066, amount: 0.35, frost: 0, chroma: 1 },
            bark: { color: 0xb0745e, amount: 0.3, frost: 0, chroma: 1 },
            water: { color: 0x8a8fe0, amount: 0.2, frost: 0, chroma: 1 },
        },
        // Powdered sugar over icy lilac, never grey.
        winter: {
            leaf: { color: 0xc9c2f2, amount: 0.3, frost: 0.55, chroma: 1 },
            petal: { color: 0xf2c2de, amount: 0.25, frost: 0.4, chroma: 1 },
            cap: { color: 0xf7cfe4, amount: 0.15, frost: 0.7, chroma: 1 },
            ground: { color: 0xe6e0fa, amount: 0.35, frost: 0.75, chroma: 1 },
            bark: { color: 0xbf8fa8, amount: 0.1, frost: 0.2, chroma: 1 },
            water: { color: 0xbfe3f7, amount: 0.4, frost: 0, chroma: 1 },
        },
    },
};
