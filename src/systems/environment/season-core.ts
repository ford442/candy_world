/**
 * Pure season math: wall-clock calendar → season state → per-material-role
 * tint parameters. No imports, so it runs under plain tsx tests and adds no
 * edge to the module graph; `season-controller.ts` wires it to the world.
 *
 * Season is a function of (world seed, wall-clock ms) only. Two players in the
 * same presence room (room = seed) therefore see the same season with no
 * protocol change, and nothing needs saving. See docs/SEASONS.md.
 *
 * Spring is the identity season: every spring palette entry has amount 0,
 * frost 0 and chroma 1, and the tint below is exact at those values, so the
 * world looks the way it was authored.
 */

export const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'] as const;
export type SeasonName = (typeof SEASON_NAMES)[number];

/** Season indices into SEASON_NAMES. */
export const SPRING = 0;
export const SUMMER = 1;
export const AUTUMN = 2;
export const WINTER = 3;

/**
 * Material roles a season can repaint. A material opts into exactly one; light
 * sources, faces and anything underground opt into none.
 */
export const SEASON_ROLES = ['leaf', 'petal', 'cap', 'ground', 'bark', 'water'] as const;
export type SeasonRole = (typeof SEASON_ROLES)[number];

export const SEASON_ROLE_INDEX: Readonly<Record<SeasonRole, number>> = {
    leaf: 0,
    petal: 1,
    cap: 2,
    ground: 3,
    bark: 4,
    water: 5,
};

/**
 * Floats per role in the blended parameter buffer:
 * [targetR, targetG, targetB (linear, luminance 1), amount, frost, chroma].
 */
export const SEASON_ROLE_STRIDE = 6;

/** Rec. 709 luminance weights for linear RGB — the shader uses the same. */
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

const DAY_MS = 86_400_000;

/** How one season repaints one role. Colours are sRGB hex, like the rest of CONFIG. */
export interface SeasonRolePaint {
    /** Hue the role moves toward. Only its hue and saturation matter; luminance is kept. */
    color: number;
    /** 0 = untouched, 1 = fully the target hue at the original luminance. */
    amount: number;
    /** Powdered-sugar coverage on upward-facing surfaces, 0..1. */
    frost: number;
    /** Saturation multiplier around luminance. 1 = untouched; never below 1. */
    chroma: number;
}

export type SeasonRolePalette = Record<SeasonRole, SeasonRolePaint>;
export type SeasonPalette = Record<SeasonName, SeasonRolePalette>;

export interface SeasonCalendarConfig {
    /** False pins spring (the identity season) unless `?season=` says otherwise. */
    enabled: boolean;
    /** Real days each season lasts. A year is four of these. */
    realDaysPerSeason: number;
    /** Wall-clock ms at which year progress is 0 (start of spring) before the seed phase. */
    epochMs: number;
    /** Offset each seed's year by a hash of the seed, so different worlds sit in different seasons. */
    seedPhase: boolean;
    /**
     * Fraction of a season spent cross-fading, centred on each boundary
     * (0.25 = the last 12.5% of one season and the first 12.5% of the next).
     */
    transitionFraction: number;
}

export interface SeasonConfig extends SeasonCalendarConfig {
    /** sRGB hex frost colour: a tinted cream, never neutral white or grey. */
    frostColor: number;
    palette: SeasonPalette;
}

export interface SeasonState {
    /** Clock (ms) this state was computed for, after any `?seasonSpeed` scaling. */
    nowMs: number;
    seed: number;
    /** 0..1 through the year; 0 = start of spring, 0.25 summer, 0.5 autumn, 0.75 winter. */
    yearProgress: number;
    /** Season the calendar is in (index into SEASON_NAMES). */
    current: number;
    /** 0..1 through the current season. */
    seasonProgress: number;
    /** Season being blended from and to; equal outside a transition window. */
    from: number;
    to: number;
    /** Weight of `to`, 0..1, smoothstepped; 0.5 exactly on a boundary. */
    blend: number;
    /** Per-season weights, summing to 1. */
    weights: Float32Array;
    /** Winter weight, 0..1. */
    frost: number;
    /** 1 at midsummer, 0 at midwinter. */
    sunInclination: number;
    /** Pinned season index, or -1 when the calendar is live. */
    pinned: number;
}

export function createSeasonState(): SeasonState {
    return {
        nowMs: 0,
        seed: 0,
        yearProgress: 0,
        current: SPRING,
        seasonProgress: 0,
        from: SPRING,
        to: SPRING,
        blend: 0,
        weights: new Float32Array([1, 0, 0, 0]),
        frost: 0,
        sunInclination: 0.5,
        pinned: -1,
    };
}

function fmix32(h: number): number {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

/** Order-sensitive 32-bit integer hash of up to three integers. */
export function hash32(a: number, b: number, c = 0): number {
    let h = fmix32((a | 0) ^ 0x9e3779b9);
    h = fmix32(h ^ (b | 0) ^ 0x85ebca6b);
    return fmix32(h ^ (c | 0) ^ 0xc2b2ae35);
}

/** Where in the year a seed's calendar starts, 0..1. */
export function seasonPhaseOffset01(seed: number): number {
    return hash32(seed, 0x5ea50) / 4294967296;
}

/** 0..1 through the year for a wall-clock time. */
export function computeYearProgress(
    nowMs: number,
    seed: number,
    cal: SeasonCalendarConfig
): number {
    const seasonMs = Math.max(cal.realDaysPerSeason, 1e-6) * DAY_MS;
    const years =
        (nowMs - cal.epochMs) / (4 * seasonMs) + (cal.seedPhase ? seasonPhaseOffset01(seed) : 0);
    return years - Math.floor(years);
}

function smooth01(t: number): number {
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    return c * c * (3 - 2 * c);
}

/**
 * Fill `out` with the season state at `nowMs`. `pinned` (a season index, or -1)
 * holds a season at its midpoint with no blend — that is how `?season=` and
 * `window.setSeason` work. Allocation-free.
 */
export function computeSeasonState(
    nowMs: number,
    seed: number,
    cal: SeasonCalendarConfig,
    pinned: number,
    out: SeasonState
): SeasonState {
    let pin = pinned >= 0 && pinned <= 3 ? Math.floor(pinned) : -1;
    if (!cal.enabled && pin < 0) pin = SPRING;

    const yp = pin >= 0 ? (pin + 0.5) / 4 : computeYearProgress(nowMs, seed, cal);
    const pos = yp * 4;
    let current = Math.floor(pos);
    if (current > 3) current = 3;
    const sp = pos - current;

    let from = current;
    let to = current;
    let blend = 0;
    const tf = cal.transitionFraction;
    const h = pin >= 0 ? 0 : (tf < 0 ? 0 : tf > 1 ? 1 : tf) * 0.5;
    if (h > 0) {
        if (sp < h) {
            from = (current + 3) % 4;
            blend = smooth01((sp + h) / (2 * h));
        } else if (sp > 1 - h) {
            to = (current + 1) % 4;
            blend = smooth01((sp - (1 - h)) / (2 * h));
        }
    }

    const w = out.weights;
    w[0] = 0;
    w[1] = 0;
    w[2] = 0;
    w[3] = 0;
    w[from] += 1 - blend;
    w[to] += blend;

    out.nowMs = nowMs;
    out.seed = seed;
    out.yearProgress = yp;
    out.current = current;
    out.seasonProgress = sp;
    out.from = from;
    out.to = to;
    out.blend = blend;
    out.frost = w[WINTER];
    out.sunInclination = 0.5 + 0.5 * Math.cos(2 * Math.PI * (yp - 0.375));
    out.pinned = pin;
    return out;
}

/** Season index for a name (case-insensitive), or -1. */
export function parseSeasonName(name: string | null | undefined): number {
    if (!name) return -1;
    const n = name.trim().toLowerCase();
    for (let i = 0; i < SEASON_NAMES.length; i++) {
        if (SEASON_NAMES[i] === n) return i;
    }
    return -1;
}

/** `?seasonSpeed=N`: run the calendar N× fast from page load, starting on the real date. */
export function virtualSeasonClock(nowMs: number, loadMs: number, speed: number): number {
    return speed === 1 ? nowMs : loadMs + (nowMs - loadMs) * speed;
}

/** Weighted blend of a per-season scalar table. */
export function blendSeasonScalar(
    state: SeasonState,
    table: Readonly<Record<SeasonName, number>>
): number {
    const w = state.weights;
    return w[0] * table.spring + w[1] * table.summer + w[2] * table.autumn + w[3] * table.winter;
}

function srgbChannelToLinear(c: number): number {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB hex → linear RGB, written at `out[off..off+2]`. */
export function srgbHexToLinear(hex: number, out: Float32Array, off: number): void {
    out[off] = srgbChannelToLinear(((hex >> 16) & 0xff) / 255);
    out[off + 1] = srgbChannelToLinear(((hex >> 8) & 0xff) / 255);
    out[off + 2] = srgbChannelToLinear((hex & 0xff) / 255);
}

const PREPARED_STRIDE = 6; // linear r, g, b, amount, frost, chroma

/** Palette flattened to linear floats, built once so the per-frame blend does no colour conversion. */
export interface PreparedSeasonPalette {
    data: Float32Array;
}

export function prepareSeasonPalette(palette: SeasonPalette): PreparedSeasonPalette {
    const data = new Float32Array(SEASON_NAMES.length * SEASON_ROLES.length * PREPARED_STRIDE);
    for (let s = 0; s < SEASON_NAMES.length; s++) {
        for (let r = 0; r < SEASON_ROLES.length; r++) {
            const paint = palette[SEASON_NAMES[s]][SEASON_ROLES[r]];
            const o = (s * SEASON_ROLES.length + r) * PREPARED_STRIDE;
            srgbHexToLinear(paint.color, data, o);
            data[o + 3] = paint.amount;
            data[o + 4] = paint.frost;
            data[o + 5] = paint.chroma;
        }
    }
    return { data };
}

/**
 * Blend the palette for `state` into `out` (SEASON_ROLES.length × SEASON_ROLE_STRIDE).
 *
 * Premultiplied by amount, so blending spring (amount 0) into autumn gives the
 * autumn hue at half the amount rather than a hue halfway to whatever colour
 * spring's unused entry happens to hold. The target is normalised to luminance 1
 * so the shader can scale it by each pixel's own luminance.
 */
export function blendSeasonPalette(
    state: SeasonState,
    prepared: PreparedSeasonPalette,
    out: Float32Array
): void {
    const d = prepared.data;
    const w = state.weights;
    const roles = SEASON_ROLES.length;
    for (let r = 0; r < roles; r++) {
        let amount = 0;
        let frost = 0;
        let chroma = 0;
        let cr = 0;
        let cg = 0;
        let cb = 0;
        for (let s = 0; s < 4; s++) {
            const ws = w[s];
            if (ws === 0) continue;
            const o = (s * roles + r) * PREPARED_STRIDE;
            const wa = ws * d[o + 3];
            amount += wa;
            frost += ws * d[o + 4];
            chroma += ws * d[o + 5];
            cr += wa * d[o];
            cg += wa * d[o + 1];
            cb += wa * d[o + 2];
        }
        const o = r * SEASON_ROLE_STRIDE;
        if (amount > 1e-6) {
            const lum = Math.max((LUMA_R * cr + LUMA_G * cg + LUMA_B * cb) / amount, 1e-3);
            out[o] = cr / amount / lum;
            out[o + 1] = cg / amount / lum;
            out[o + 2] = cb / amount / lum;
        } else {
            out[o] = 1;
            out[o + 1] = 1;
            out[o + 2] = 1;
        }
        out[o + 3] = amount;
        out[o + 4] = frost;
        out[o + 5] = chroma;
    }
}

/** Frost only settles on surfaces facing up: smoothstep(0.2, 0.85, normal.y), at most 80%. */
export function frostCoverage(normalY: number): number {
    const t = (normalY - 0.2) / 0.65;
    return smooth01(t) * 0.8;
}

/**
 * CPU mirror of `applySeasonTint` in material-core/season-nodes.ts, for the far
 * impostors (whose colours are copied on the CPU) and for tests. Tints the
 * linear RGB at `rgb[off..off+2]` in place.
 */
export function tintRgbInPlace(
    rgb: Float32Array,
    off: number,
    roleParams: Float32Array,
    roleOff: number,
    frostRgb: Float32Array,
    normalY: number
): void {
    const r = rgb[off];
    const g = rgb[off + 1];
    const b = rgb[off + 2];
    const lum = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    const k = roleParams[roleOff + 5] - 1;
    let cr = Math.max(r + (r - lum) * k, 0);
    let cg = Math.max(g + (g - lum) * k, 0);
    let cb = Math.max(b + (b - lum) * k, 0);
    const a = roleParams[roleOff + 3];
    cr += (Math.min(roleParams[roleOff] * lum, 1) - cr) * a;
    cg += (Math.min(roleParams[roleOff + 1] * lum, 1) - cg) * a;
    cb += (Math.min(roleParams[roleOff + 2] * lum, 1) - cb) * a;
    const f = roleParams[roleOff + 4] * frostCoverage(normalY);
    rgb[off] = cr + (frostRgb[0] - cr) * f;
    rgb[off + 1] = cg + (frostRgb[1] - cg) * f;
    rgb[off + 2] = cb + (frostRgb[2] - cb) * f;
}

/** Per-season generative-music shaping (CONFIG.season.music). */
export interface SeasonMusicConfig {
    /** Tempo multiplier. Game time is BPM-scaled, so this also stretches the day; keep it near 1. */
    tempoScale: Record<SeasonName, number>;
    /** Added to profile brightness (filter cutoff). */
    brightnessShift: Record<SeasonName, number>;
    /** Multiplier on every channel's activity. */
    densityScale: Record<SeasonName, number>;
    /** Reverb send, 0..1. */
    reverbWet: Record<SeasonName, number>;
}

/** Blended music modifier for the current season. Identity: 1, 0, 1, 0. */
export interface SeasonMusicModifier {
    tempoScale: number;
    brightnessShift: number;
    densityScale: number;
    reverbWet: number;
}

export function createSeasonMusicModifier(): SeasonMusicModifier {
    return { tempoScale: 1, brightnessShift: 0, densityScale: 1, reverbWet: 0 };
}

export function blendSeasonMusicModifier(
    state: SeasonState,
    cfg: SeasonMusicConfig,
    out: SeasonMusicModifier
): SeasonMusicModifier {
    out.tempoScale = blendSeasonScalar(state, cfg.tempoScale);
    out.brightnessShift = blendSeasonScalar(state, cfg.brightnessShift);
    out.densityScale = blendSeasonScalar(state, cfg.densityScale);
    out.reverbWet = blendSeasonScalar(state, cfg.reverbWet);
    return out;
}
