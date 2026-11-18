/**
 * @file src/systems/composer/composer-flora.ts
 * @brief Grove flora: plants placed near a music stone fill rows of its pattern (#2159 follow-up).
 *
 * Settled design (see `docs/GROVE_COMPOSER.md`, "Grove flora"):
 * - **What a plant changes:** the rows it fills. Each counted species owns one channel; while the
 *   stone's own row on that channel is all rests, nearby plants of that species fill it with a
 *   figure rolled from the stone's seed. An authored note always wins: a row with any note is left
 *   exactly as the player wrote it.
 * - **Which species, how many:** species that have a harvest id and an `InstancedBatcher` (no new
 *   batcher class): `arpeggio_fern` (fern core, `arpeggio-batcher`) and `cymbal_dandelion` (chime
 *   shards, `dandelion-batcher`). Each plant within `FLORA_RADIUS` adds `NOTES_PER_PLANT` notes, up
 *   to `MAX_PLANTS` plants per species.
 * - **Derived, not stored:** the effect is computed from live placed entities at playback time.
 *   Nothing new lands in `params.pattern`, the document or a peer message; the editor shows and
 *   saves only the authored pattern.
 * - **View-only shared worlds:** nothing to gate. A viewer cannot place plants (build mode is
 *   locked), and every client derives the same rows from the same shared entities and seed.
 *
 * Pure: no DOM, no Three.js.
 */

import {
    GROVE_REST,
    GROVE_STEPS,
    type GroveChannel,
    type GrovePattern,
} from '../../world/document/grove-pattern.ts';

/** A plant counts for a stone within this distance (m, horizontal). */
export const FLORA_RADIUS = 8;
/** Plants beyond this many of one species add nothing more. */
export const MAX_PLANTS = 4;
/** Notes each counted plant adds to its row. */
export const NOTES_PER_PLANT = 2;

export interface FloraSpecies {
    type: string;
    channel: number;
    name: string;
    /** Degrees the figure walks through (scale degrees, resolved in the biome key). */
    degrees: readonly number[];
}

/** Map entity type → the row it fills. Channels are ones the default pattern leaves empty. */
export const GROVE_FLORA: readonly FloraSpecies[] = [
    { type: 'arpeggio_fern', channel: 4, name: 'Arpeggio fern', degrees: [0, 2, 4, 7, 9, 11] },
    { type: 'cymbal_dandelion', channel: 7, name: 'Cymbal dandelion', degrees: [7, 9, 11, 13] },
];

const BY_TYPE = new Map(GROVE_FLORA.map((s) => [s.type, s]));

export function floraSpecies(type: unknown): FloraSpecies | null {
    return typeof type === 'string' ? (BY_TYPE.get(type) ?? null) : null;
}

export interface FloraPoint {
    type: string;
    x: number;
    z: number;
}

/** Per species type, how many plants (capped) stand within `FLORA_RADIUS` of `(x, z)`. */
export function countFloraNear(
    x: number,
    z: number,
    plants: Iterable<FloraPoint>
): Map<string, number> {
    const counts = new Map<string, number>();
    const r2 = FLORA_RADIUS * FLORA_RADIUS;
    for (const p of plants) {
        if (!BY_TYPE.has(p.type)) continue;
        const dx = p.x - x;
        const dz = p.z - z;
        if (dx * dx + dz * dz > r2) continue;
        counts.set(p.type, Math.min(MAX_PLANTS, (counts.get(p.type) ?? 0) + 1));
    }
    return counts;
}

/** A stable key for `counts` (same counts → same key), for caching the derived pattern. */
export function floraKey(counts: ReadonlyMap<string, number>): string {
    return GROVE_FLORA.map((s) => counts.get(s.type) ?? 0).join(',');
}

/** mulberry32, as in `grove-pattern.ts`. */
function rng(seed: number): () => number {
    let state = seed >>> 0 || 0x6d2b79f5;
    return () => {
        let t = (state += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The row `count` plants of `species` play for a stone seeded `seed`: `count * NOTES_PER_PLANT`
 * notes on evenly spread steps (offset per stone), walking the species' degrees. Adding a plant
 * keeps every note it already had.
 */
export function floraRow(species: FloraSpecies, seed: number, count: number): number[] {
    const row = new Array<number>(GROVE_STEPS).fill(GROVE_REST);
    const n = Math.min(MAX_PLANTS, Math.max(0, count | 0)) * NOTES_PER_PLANT;
    if (n === 0) return row;
    const next = rng((seed ^ Math.imul(species.channel + 1, 0x9e3779b1)) >>> 0);
    const offset = Math.floor(next() * GROVE_STEPS);
    const start = Math.floor(next() * species.degrees.length);
    // Bit-reversed order over 8 slots, so the first notes are spread across the bar and later
    // plants fill the gaps between them.
    const order = [0, 4, 2, 6, 1, 5, 3, 7];
    const span = GROVE_STEPS / order.length;
    for (let i = 0; i < n; i++) {
        const stepIdx = (offset + order[i] * span) % GROVE_STEPS;
        row[stepIdx] = species.degrees[(start + order[i]) % species.degrees.length];
    }
    return row;
}

function isEmptyRow(row: GroveChannel | undefined): boolean {
    return !!row && row.notes.every((n) => n === GROVE_REST);
}

/**
 * `pattern` with the rows nearby flora fill. Returns `pattern` itself when nothing changes, so a
 * stone without flora plays exactly its authored pattern.
 */
export function applyGroveFlora(
    pattern: GrovePattern,
    counts: ReadonlyMap<string, number>
): GrovePattern {
    let out: GrovePattern | null = null;
    for (const species of GROVE_FLORA) {
        const count = counts.get(species.type) ?? 0;
        if (count <= 0) continue;
        const row = pattern.channels[species.channel];
        if (!isEmptyRow(row)) continue;
        out ??= { ...pattern, channels: pattern.channels.slice() };
        out.channels[species.channel] = { ...row, notes: floraRow(species, pattern.seed, count) };
    }
    return out ?? pattern;
}
