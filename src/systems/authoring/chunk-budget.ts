/**
 * @file src/systems/authoring/chunk-budget.ts
 * @brief Per-chunk and world caps on player-placed entities (docs/PERF_BUDGETS.md).
 *
 * The caps live in `SYSTEM_BUDGETS.authoring`; a placement past either is
 * rejected (and recorded for the `?debug=1` overlay), never queued.
 */

import type * as THREE from 'three';
import { DEFAULT_MAP_CHUNK_STREAM_SIZE } from '../../world/map-chunk-size.ts';
import { getAuthoredTransform } from '../entity-snapshot-core.ts';
import { getCap, withinCap } from '../performance-budget/systems-budget.ts';

export const AUTHORING_CHUNK_SIZE = DEFAULT_MAP_CHUNK_STREAM_SIZE;

export function chunkKeyOf(x: number, z: number): string {
    return `${Math.floor(x / AUTHORING_CHUNK_SIZE)},${Math.floor(z / AUTHORING_CHUNK_SIZE)}`;
}

export interface AuthoredCounts {
    total: number;
    perChunk: Map<string, number>;
    /** Entity ids counted (authored entities with an id). */
    ids: Set<string>;
}

/**
 * Count authored entities (anything stamped with an authored transform), once
 * per entity id: a batched entity can register several objects.
 */
export function countAuthored(
    objects: ArrayLike<THREE.Object3D | null | undefined>
): AuthoredCounts {
    const counts: AuthoredCounts = { total: 0, perChunk: new Map(), ids: new Set() };
    const seen = counts.ids;
    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (!obj || !getAuthoredTransform(obj)) continue;
        const id: unknown = obj.userData?.mapEntityId;
        if (typeof id === 'string') {
            if (seen.has(id)) continue;
            seen.add(id);
        }
        const key = chunkKeyOf(obj.position.x, obj.position.z);
        counts.perChunk.set(key, (counts.perChunk.get(key) ?? 0) + 1);
        counts.total++;
    }
    return counts;
}

export type BudgetCheck = { ok: true } | { ok: false; message: string };

/** May `adding` more entities go at (x, z)? */
export function checkPlacementBudget(
    counts: AuthoredCounts,
    x: number,
    z: number,
    adding = 1
): BudgetCheck {
    const inChunk = (counts.perChunk.get(chunkKeyOf(x, z)) ?? 0) + adding;
    if (!withinCap('authoring', 'perChunk', inChunk)) {
        return {
            ok: false,
            message: `This grove is full (${getCap('authoring', 'perChunk')} pieces). Build somewhere else!`,
        };
    }
    if (!withinCap('authoring', 'total', counts.total + adding)) {
        return {
            ok: false,
            message: `Your world is full (${getCap('authoring', 'total')} pieces). Remove some to build more.`,
        };
    }
    return { ok: true };
}

export interface BudgetMove {
    id: string;
    from: readonly [x: number, z: number];
    to: readonly [x: number, z: number];
}

/**
 * May these pieces move? Each authored piece leaves its chunk for another; a
 * map piece becomes authored (it counts from now on). Only a chunk that
 * grows, or a total that grows, can be over its cap.
 */
export function checkMoveBudget(counts: AuthoredCounts, moves: readonly BudgetMove[]): BudgetCheck {
    const perChunk = new Map(counts.perChunk);
    let total = counts.total;
    const landed = new Set<string>();
    for (const move of moves) {
        if (counts.ids.has(move.id)) {
            const from = chunkKeyOf(move.from[0], move.from[1]);
            perChunk.set(from, (perChunk.get(from) ?? 0) - 1);
        } else {
            total++;
        }
        const to = chunkKeyOf(move.to[0], move.to[1]);
        perChunk.set(to, (perChunk.get(to) ?? 0) + 1);
        landed.add(to);
    }
    for (const key of landed) {
        const after = perChunk.get(key) ?? 0;
        if (after > (counts.perChunk.get(key) ?? 0) && !withinCap('authoring', 'perChunk', after)) {
            return {
                ok: false,
                message: `That grove is full (${getCap('authoring', 'perChunk')} pieces). Move it somewhere else!`,
            };
        }
    }
    if (total > counts.total && !withinCap('authoring', 'total', total)) {
        return {
            ok: false,
            message: `Your world is full (${getCap('authoring', 'total')} pieces). Remove some to move map pieces.`,
        };
    }
    return { ok: true };
}
