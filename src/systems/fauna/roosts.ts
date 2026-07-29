/**
 * @file src/systems/fauna/roosts.ts
 * @brief Sky-island roost anchors for ambient fauna flocks (#1363 task 7).
 *
 * The ambient fauna scatter in `spawn.ts` samples random XZ across the world
 * and reads Y from the unified ground query. That works for terrain, but it
 * effectively never lands on the stacked sky islands: the decks are a few
 * hundred m² inside a ~58k m² sample area, so a random pass finds them at
 * roughly the rate of their area share (well under 1%).
 *
 * Roosts fix that by reserving a slice of the population and placing it
 * directly on registered island decks. Anchors are derived from the live
 * `sky-islands` registry, so they inherit whatever the world decorator
 * actually placed — no second source of truth for island positions.
 *
 * Y is intentionally *not* taken from the anchor. Callers resolve it through
 * the unified ground query (`getGroundHeight`), which returns the deck via the
 * walkable-platform override registered by `registerWalkableIslandPlatform`.
 * That keeps roosts on the same placement path as every other sky-island
 * entity and preserves the #1265 no-float-sink guarantee.
 */

import { getRegisteredSkyIslands, type SkyIslandLayerKind } from '../../foliage/sky-islands.ts';

/**
 * Minimal island shape a roost plan needs. Structurally satisfied by
 * `SkyIslandRecord`, but declared separately so the planner stays pure and
 * unit-testable without constructing three.js objects.
 */
export interface SkyIslandRoostSource {
    id: string;
    layerId: string;
    kind: SkyIslandLayerKind;
    x: number;
    y: number;
    z: number;
    radius: number;
}

export interface RoostAnchor {
    islandId: string;
    layerId: string;
    kind: SkyIslandLayerKind;
    x: number;
    /** Deck Y from the registry — a *hint*; resolve the real Y via getGroundHeight. */
    y: number;
    z: number;
}

export interface RoostPlanOptions {
    /** Roost anchors to place per island deck. */
    perIsland: number;
    /** Ring radius as a fraction of deck radius. Keeps roosts off the rim. */
    ringInset: number;
    /** Random offset as a fraction of deck radius, so rings do not look stamped. */
    jitter: number;
}

export const DEFAULT_ROOST_PLAN: RoostPlanOptions = {
    perIsland: 4,
    // Deck geometry: the walkable disc is radius * 0.92 and the platform AABB is
    // radius * 0.9, while createSkyIsland() pushes rim displacement past 0.45.
    // 0.55 sits inside the flat centre with margin on both sides.
    ringInset: 0.55,
    jitter: 0.12,
};

/**
 * Distribute roost anchors evenly around each island deck.
 *
 * Pure: same islands + same options + same RNG sequence → same anchors.
 * Islands with a non-finite or non-positive radius are skipped rather than
 * producing NaN positions.
 *
 * @param islands Registered island decks.
 * @param opts Ring layout tuning.
 * @param rng Deterministic 0..1 source; jitter is skipped entirely when omitted.
 */
export function planRoostAnchors(
    islands: readonly SkyIslandRoostSource[],
    opts: RoostPlanOptions = DEFAULT_ROOST_PLAN,
    rng?: () => number,
): RoostAnchor[] {
    const anchors: RoostAnchor[] = [];
    const perIsland = Math.max(0, Math.floor(opts.perIsland));
    if (perIsland === 0) return anchors;

    for (const island of islands) {
        if (!Number.isFinite(island.radius) || island.radius <= 0) continue;
        if (!Number.isFinite(island.x) || !Number.isFinite(island.z)) continue;

        const ring = island.radius * opts.ringInset;
        const jitterAmp = island.radius * opts.jitter;

        for (let i = 0; i < perIsland; i++) {
            // Offset each island's ring so decks do not share a spoke pattern.
            const angle = (i / perIsland) * Math.PI * 2 + (island.layerId.length % 7) * 0.31;
            const jx = rng ? (rng() - 0.5) * 2 * jitterAmp : 0;
            const jz = rng ? (rng() - 0.5) * 2 * jitterAmp : 0;

            anchors.push({
                islandId: island.id,
                layerId: island.layerId,
                kind: island.kind,
                x: island.x + Math.cos(angle) * ring + jx,
                y: island.y,
                z: island.z + Math.sin(angle) * ring + jz,
            });
        }
    }

    return anchors;
}

/**
 * Plan roosts against the live sky-island registry.
 * Returns an empty array when no islands are registered (CORE mode, or
 * `SKY_ISLANDS.enabled === false`) so callers degrade to a plain scatter.
 */
export function getSkyIslandRoostAnchors(
    opts: RoostPlanOptions = DEFAULT_ROOST_PLAN,
    rng?: () => number,
): RoostAnchor[] {
    return planRoostAnchors(getRegisteredSkyIslands(), opts, rng);
}
