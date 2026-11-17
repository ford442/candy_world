/**
 * @file src/world/document/grove-pattern.ts
 * @brief The grove composer's pattern (#1976 slice C): 8 voices × 16 steps of scale degrees.
 *
 * A pattern lives on a `music_stone` entity, in `entity.params.pattern`, so it is saved, replayed,
 * merged and shared exactly like any other authored entity state: placing a stone is a `place`,
 * editing its pattern is a `compose` (`schema.ts`). Cells hold scale degrees, not pitches; the
 * key and scale come from the biome profile where the stone is heard (`GenerativeSequencer`), so
 * an authored pattern always fits the music around it.
 *
 * Renderer-free, with runtime imports only from valibot, so the `validate-world` edge function
 * (Deno) loads it through `schema.ts` unchanged.
 */

import * as v from 'valibot';

/** The map entity type that carries a pattern. */
export const MUSIC_STONE_TYPE = 'music_stone';

export const GROVE_PATTERN_VERSION = 1;
/** One voice per tracker channel (`CHANNEL_VOICES` in `audio/generative/sequencer.ts`). */
export const GROVE_CHANNELS = 8;
export const GROVE_STEPS = 16;
/** A cell that plays nothing. */
export const GROVE_REST = -1;
/** Two octaves of a seven-note scale above the voice's root, 0-based. */
export const GROVE_MAX_DEGREE = 13;

/** Living Score cue ids (`assets/score-cues.json`): `market.lantern_fill`, `island.glow`. */
const CUE_ID_RE = /^[a-z0-9_]{1,32}(\.[a-z0-9_]{1,32}){0,3}$/;

const DegreeSchema = v.pipe(
    v.number(),
    v.integer(),
    v.minValue(GROVE_REST),
    v.maxValue(GROVE_MAX_DEGREE)
);

export const GroveChannelSchema = v.strictObject({
    /** One degree (or `GROVE_REST`) per step. */
    notes: v.pipe(v.array(DegreeSchema), v.length(GROVE_STEPS)),
    /** A Living Score cue that fires on the steps this row plays. */
    cue: v.optional(v.pipe(v.string(), v.regex(CUE_ID_RE, 'must be a Living Score cue id'))),
});

export const GrovePatternSchema = v.strictObject({
    v: v.literal(GROVE_PATTERN_VERSION),
    /** The seed the default pattern was rolled from; kept so "Reset" gives the same one back. */
    seed: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(0xffffffff)),
    channels: v.pipe(v.array(GroveChannelSchema), v.length(GROVE_CHANNELS)),
});

export type GroveChannel = v.InferOutput<typeof GroveChannelSchema>;
export type GrovePattern = v.InferOutput<typeof GrovePatternSchema>;

/** The pattern, or null when `raw` is not a valid one. */
export function parseGrovePattern(raw: unknown): GrovePattern | null {
    const result = v.safeParse(GrovePatternSchema, raw);
    return result.success ? result.output : null;
}

/** Why `raw` is not a valid pattern (a message with its path), or null when it is. */
export function grovePatternIssue(raw: unknown): string | null {
    const result = v.safeParse(GrovePatternSchema, raw);
    if (result.success) return null;
    const issue = result.issues[0];
    const path = v.getDotPath(issue);
    return path ? `${path}: ${issue.message}` : issue.message;
}

// ---------------------------------------------------------------------------
// Seeds and the default pattern
// ---------------------------------------------------------------------------

/** FNV-1a: a stone's id → its default seed, the same on every client. */
export function grovePatternSeed(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** mulberry32, as `audio/generative/prng.ts` (copied: this module may not import that chunk). */
function rng(seed: number): () => number {
    let state = seed >>> 0 || 0x6d2b79f5;
    return () => {
        let t = (state += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function restRow(): number[] {
    return new Array<number>(GROVE_STEPS).fill(GROVE_REST);
}

/** Every cell a rest. */
export function emptyGrovePattern(seed: number): GrovePattern {
    const channels: GroveChannel[] = [];
    for (let ch = 0; ch < GROVE_CHANNELS; ch++) channels.push({ notes: restRow() });
    return { v: GROVE_PATTERN_VERSION, seed: seed >>> 0, channels };
}

/**
 * The pattern a stone plays until someone composes one: a four-on-the-floor pulse, a short
 * melody and a rising arpeggio, rolled from `seed`. Only the starter voices (`COMPOSER_VOICES`
 * in `systems/composer/composer-voices.ts`) play, so it sounds the same before any unlock.
 */
export function defaultGrovePattern(seed: number): GrovePattern {
    const pattern = emptyGrovePattern(seed);
    const next = rng(seed);
    const kick = pattern.channels[0].notes;
    for (let s = 0; s < GROVE_STEPS; s += 4) kick[s] = 0;
    if (next() < 0.5) kick[14] = 0;

    // Melody: a degree walk on the off-beats, resting about a third of the time.
    const melody = pattern.channels[2].notes;
    let degree = Math.floor(next() * 5);
    for (let s = 2; s < GROVE_STEPS; s += 2) {
        if (next() < 0.35) continue;
        degree = Math.max(0, Math.min(9, degree + Math.floor(next() * 5) - 2));
        melody[s] = degree;
    }

    // Arpeggio: root, third, fifth, octave, from a seeded starting step.
    const arp = pattern.channels[3].notes;
    const shape = [0, 2, 4, 7];
    const offset = Math.floor(next() * 4);
    for (let s = 0; s < GROVE_STEPS; s++) {
        if ((s + offset) % 2 === 0) arp[s] = shape[((s + offset) / 2) % shape.length];
    }
    return pattern;
}

// ---------------------------------------------------------------------------
// Edits (pure: each returns a new pattern)
// ---------------------------------------------------------------------------

export function cloneGrovePattern(pattern: GrovePattern): GrovePattern {
    return {
        v: pattern.v,
        seed: pattern.seed,
        channels: pattern.channels.map((c) => {
            const out: GroveChannel = { notes: c.notes.slice() };
            if (c.cue !== undefined) out.cue = c.cue;
            return out;
        }),
    };
}

function clampDegree(degree: number): number {
    if (!Number.isFinite(degree)) return GROVE_REST;
    return Math.max(GROVE_REST, Math.min(GROVE_MAX_DEGREE, Math.round(degree)));
}

export function withGroveCell(
    pattern: GrovePattern,
    channel: number,
    step: number,
    degree: number
): GrovePattern {
    const out = cloneGrovePattern(pattern);
    const row = out.channels[channel];
    if (!row || step < 0 || step >= GROVE_STEPS) return out;
    row.notes[step] = clampDegree(degree);
    return out;
}

/** Bind `cue` to a row, or unbind it with null. */
export function withGroveCue(
    pattern: GrovePattern,
    channel: number,
    cue: string | null
): GrovePattern {
    const out = cloneGrovePattern(pattern);
    const row = out.channels[channel];
    if (!row) return out;
    if (cue === null || cue === '') delete row.cue;
    else row.cue = cue;
    return out;
}

/** Every cell of one row a rest (its cue stays). */
export function withGroveRowCleared(pattern: GrovePattern, channel: number): GrovePattern {
    const out = cloneGrovePattern(pattern);
    const row = out.channels[channel];
    if (row) row.notes = restRow();
    return out;
}

export function sameGrovePattern(a: GrovePattern, b: GrovePattern): boolean {
    if (a.v !== b.v || a.seed !== b.seed) return false;
    for (let ch = 0; ch < GROVE_CHANNELS; ch++) {
        const x = a.channels[ch];
        const y = b.channels[ch];
        if ((x.cue ?? '') !== (y.cue ?? '')) return false;
        for (let s = 0; s < GROVE_STEPS; s++) if (x.notes[s] !== y.notes[s]) return false;
    }
    return true;
}

/** Cells that play something. */
export function groveNoteCount(pattern: GrovePattern): number {
    let n = 0;
    for (const row of pattern.channels) for (const d of row.notes) if (d !== GROVE_REST) n++;
    return n;
}

// ---------------------------------------------------------------------------
// Music stone snapshots (checked by `schema.ts` at the document boundary)
// ---------------------------------------------------------------------------

interface SnapshotLike {
    id?: unknown;
    entity?: { type?: unknown; params?: unknown };
}

function paramsOf(snapshot: SnapshotLike): Record<string, unknown> | undefined {
    const params = snapshot.entity?.params;
    return params && typeof params === 'object' && !Array.isArray(params)
        ? (params as Record<string, unknown>)
        : undefined;
}

/** The stone's authored pattern, or null when it has none (it plays its default). */
export function stonePatternOf(snapshot: SnapshotLike): GrovePattern | null {
    return parseGrovePattern(paramsOf(snapshot)?.pattern);
}

/**
 * The pattern a stone plays: its authored one, else the default rolled from its id. Every client
 * gets the same notes for the same stone.
 */
export function resolveStonePattern(id: string, rawPattern: unknown): GrovePattern {
    return parseGrovePattern(rawPattern) ?? defaultGrovePattern(grovePatternSeed(id));
}

/** True unless `snapshot` is a music stone whose `params.pattern` is present and invalid. */
export function musicStoneSnapshotOk(snapshot: unknown): boolean {
    const s = snapshot as SnapshotLike | null;
    if (!s || s.entity?.type !== MUSIC_STONE_TYPE) return true;
    const raw = paramsOf(s)?.pattern;
    return raw === undefined || parseGrovePattern(raw) !== null;
}

/** JSON with sorted keys and `undefined` members dropped. */
function sortedJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(obj).sort()) {
        if (obj[key] === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${sortedJson(obj[key])}`);
    }
    return `{${parts.join(',')}}`;
}

/** The snapshot without `entity.params.pattern`: everything a compose must leave alone. */
function withoutPattern(snapshot: unknown): string {
    const s = snapshot as { entity?: Record<string, unknown> } | null;
    if (!s || typeof s !== 'object' || !s.entity || typeof s.entity !== 'object') {
        return sortedJson(snapshot);
    }
    const params = paramsOf(s);
    const restParams: Record<string, unknown> = { ...(params ?? {}) };
    delete restParams.pattern;
    const entity: Record<string, unknown> = { ...s.entity };
    if (params) entity.params = restParams;
    return sortedJson({ ...s, entity });
}

/**
 * A `compose` edits one music stone's pattern and nothing else: same id, both sides stones, the
 * new side carries a valid pattern, and the rest of the snapshot is unchanged.
 */
export function composeIssue(from: unknown, to: unknown): string | null {
    const a = from as SnapshotLike;
    const b = to as SnapshotLike;
    if (a?.id !== b?.id) return 'a compose keeps its stone (from and to share an id)';
    if (a?.entity?.type !== MUSIC_STONE_TYPE || b?.entity?.type !== MUSIC_STONE_TYPE) {
        return `a compose edits a ${MUSIC_STONE_TYPE}`;
    }
    const issue = grovePatternIssue(paramsOf(b)?.pattern);
    if (issue) return `invalid grove pattern (${issue})`;
    if (withoutPattern(from) !== withoutPattern(to)) {
        return 'a compose changes only the pattern';
    }
    return null;
}

/** `from` with `pattern` as its `params.pattern`: the `to` side of a compose. */
export function withStonePattern<T extends { entity: { params?: Record<string, unknown> } }>(
    from: T,
    pattern: GrovePattern
): T {
    return {
        ...from,
        entity: {
            ...from.entity,
            params: { ...(from.entity.params ?? {}), pattern: cloneGrovePattern(pattern) },
        },
    };
}
