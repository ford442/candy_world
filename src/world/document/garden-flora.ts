/**
 * @file src/world/document/garden-flora.ts
 * @brief Music Garden slice B's two planted instruments: the chime tulip and the drum puffball.
 *
 * Both are ordinary map entities. What each plays rides `entity.params`, so it is saved, replayed,
 * merged and shared like any other authored entity state (`place` / `move` / `remove` in
 * `world-commands.ts`; nothing here adds a second persistence path). Every param is optional: a
 * plant that has none plays the figure rolled from its id (`resolveChimeTulip`,
 * `resolveDrumPuffball`), the same on every client, exactly as an uncomposed music stone plays its
 * seeded default (`grove-pattern.ts`).
 *
 * - **Chime tulip**: `degree` is a scale degree 0..13 (resolved in the biome key where it is
 *   heard, as the grove pattern's cells are) and `step` the 16th it chimes on. It chimes again
 *   half a bar later (`docs/MUSIC_GARDEN.md`).
 * - **Drum puffball**: `drum` is `kick`, `snare` or `hat`, and `shift` rotates its figure 0..3
 *   sixteenths.
 *
 * Renderer-free, with runtime imports only from valibot and `grove-pattern.ts`, so the
 * `validate-world` edge function (Deno) loads it through `schema.ts` unchanged.
 */

import * as v from 'valibot';
import { grovePatternSeed } from './grove-pattern.ts';

export const CHIME_TULIP_TYPE = 'chime_tulip';
export const DRUM_PUFFBALL_TYPE = 'drum_puffball';

/** The garden's grid: sixteenth notes, one bar. The same grid as the grove pattern. */
export const GARDEN_STEPS = 16;
/** Two octaves of a seven-note scale, 0-based (`GROVE_MAX_DEGREE`). */
export const GARDEN_MAX_DEGREE = 13;
export const GARDEN_MAX_SHIFT = 3;

export const DRUM_KINDS = ['kick', 'snare', 'hat'] as const;
export type DrumKind = (typeof DRUM_KINDS)[number];

const ChimeTulipParamsSchema = v.object({
    degree: v.optional(
        v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(GARDEN_MAX_DEGREE))
    ),
    step: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(GARDEN_STEPS - 1))),
});

const DrumPuffballParamsSchema = v.object({
    drum: v.optional(v.picklist(DRUM_KINDS)),
    shift: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(GARDEN_MAX_SHIFT))),
});

export interface ChimeTulipFigure {
    degree: number;
    step: number;
}

export interface DrumPuffballFigure {
    drum: DrumKind;
    shift: number;
}

/** Whether `type` is one of the two garden instruments. */
export function isGardenFloraType(type: unknown): type is 'chime_tulip' | 'drum_puffball' {
    return type === CHIME_TULIP_TYPE || type === DRUM_PUFFBALL_TYPE;
}

/** mulberry32, as `grove-pattern.ts` (copied: that one is private). */
function rng(seed: number): () => number {
    let state = seed >>> 0 || 0x6d2b79f5;
    return () => {
        let t = (state += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Consonant degrees a rolled chime picks from: root, third, fifth, sixth and octaves of them. */
const CHIME_DEGREES = [0, 2, 4, 5, 7, 9, 11, 12] as const;

/** The figure a chime tulip with no params of its own plays: rolled from its id. */
export function defaultChimeTulip(id: string): ChimeTulipFigure {
    const next = rng(grovePatternSeed(`${id}:chime`));
    const degree = CHIME_DEGREES[Math.floor(next() * CHIME_DEGREES.length)];
    // Mostly on the eighth-note grid, sometimes syncopated.
    const step = Math.floor(next() * 8) * 2 + (next() < 0.25 ? 1 : 0);
    return { degree, step };
}

/** The figure a drum puffball with no params of its own plays: rolled from its id. */
export function defaultDrumPuffball(id: string): DrumPuffballFigure {
    const next = rng(grovePatternSeed(`${id}:drum`));
    const roll = next();
    const drum: DrumKind = roll < 0.4 ? 'kick' : roll < 0.7 ? 'snare' : 'hat';
    return { drum, shift: next() < 0.8 ? 0 : 1 };
}

function paramsOf(raw: unknown): Record<string, unknown> | undefined {
    return raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : undefined;
}

/** What a chime tulip plays: its own `degree` / `step`, the id's roll for any it lacks or has wrong. */
export function resolveChimeTulip(id: string, rawParams: unknown): ChimeTulipFigure {
    const base = defaultChimeTulip(id);
    const parsed = v.safeParse(ChimeTulipParamsSchema, paramsOf(rawParams) ?? {});
    if (!parsed.success) return base;
    return {
        degree: parsed.output.degree ?? base.degree,
        step: parsed.output.step ?? base.step,
    };
}

/** What a drum puffball plays: its own `drum` / `shift`, the id's roll for any it lacks or has wrong. */
export function resolveDrumPuffball(id: string, rawParams: unknown): DrumPuffballFigure {
    const base = defaultDrumPuffball(id);
    const parsed = v.safeParse(DrumPuffballParamsSchema, paramsOf(rawParams) ?? {});
    if (!parsed.success) return base;
    return {
        drum: parsed.output.drum ?? base.drum,
        shift: parsed.output.shift ?? base.shift,
    };
}

interface SnapshotLike {
    entity?: { type?: unknown; params?: unknown };
}

/** Why `snapshot`'s garden params are invalid, or null (also null for any other entity). */
export function gardenFloraIssue(snapshot: unknown): string | null {
    const s = snapshot as SnapshotLike | null;
    const type = s?.entity?.type;
    if (!isGardenFloraType(type)) return null;
    const raw = s?.entity?.params;
    if (raw === undefined) return null;
    const params = paramsOf(raw);
    if (!params) return `${type} params must be an object`;
    const schema = type === CHIME_TULIP_TYPE ? ChimeTulipParamsSchema : DrumPuffballParamsSchema;
    const result = v.safeParse(schema, params);
    if (result.success) return null;
    const issue = result.issues[0];
    const path = v.getDotPath(issue);
    return `${type} ${path ? `${path}: ` : ''}${issue.message}`;
}

/** True unless `snapshot` is a garden instrument whose present params are invalid. */
export function gardenFloraSnapshotOk(snapshot: unknown): boolean {
    return gardenFloraIssue(snapshot) === null;
}

// ---------------------------------------------------------------------------
// When a plant plays
// ---------------------------------------------------------------------------

/** A tulip chimes on `step` and half a bar later. */
export function chimeHitsOn(figure: ChimeTulipFigure, step: number): boolean {
    return step === figure.step || step === (figure.step + GARDEN_STEPS / 2) % GARDEN_STEPS;
}

/** A puffball's figure: kick on the one and the three, snare on the two and the four, hat on the off-beats. */
export function drumHitsOn(figure: DrumPuffballFigure, step: number): boolean {
    const s = (((step - figure.shift) % GARDEN_STEPS) + GARDEN_STEPS) % GARDEN_STEPS;
    switch (figure.drum) {
        case 'kick':
            return s % 8 === 0;
        case 'snare':
            return s % 8 === 4;
        case 'hat':
            return s % 4 === 2;
    }
}
