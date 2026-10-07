/**
 * Winter lake ice (docs/SEASONS.md, "Frozen lake").
 *
 * The lake has no collider: the basin is carved terrain, and swimming is an
 * eye-height check against the water level. Ice is therefore a ground-height
 * rule, not a mesh: while it is solid, any point over open water reports the
 * water surface as its ground, so the character controller walks on it and
 * never enters the swim state (calculateWaterLevel compares eye height).
 *
 * The island stays as it is, and a hole stays open along the Sugar Caves
 * descent, so the caves are reachable all year.
 */
import {
    LAKE_BOUNDS,
    LAKE_DESCENT,
    LAKE_ISLAND_RADIUS_SQ,
    LAKE_ISLAND,
} from '../ground-height-core.ts';

/** Ice surface height: the basin water level used by calculateWaterLevel. */
export const LAKE_ICE_Y = 1.5;

/** Half-width (m) of the open strip left over the descent ramp (platforms are 5 m wide). */
export const LAKE_ICE_HOLE_HALF_WIDTH = 3.5;

const HOLE_SQ = LAKE_ICE_HOLE_HALF_WIDTH * LAKE_ICE_HOLE_HALF_WIDTH;
const ABX = LAKE_DESCENT.bx - LAKE_DESCENT.ax;
const ABZ = LAKE_DESCENT.bz - LAKE_DESCENT.az;
const AB_LEN_SQ = ABX * ABX + ABZ * ABZ;

/** Squared distance from (x, z) to the descent segment. */
export function distanceToDescentSq(x: number, z: number): number {
    let t = ((x - LAKE_DESCENT.ax) * ABX + (z - LAKE_DESCENT.az) * ABZ) / AB_LEN_SQ;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (LAKE_DESCENT.ax + ABX * t);
    const dz = z - (LAKE_DESCENT.az + ABZ * t);
    return dx * dx + dz * dz;
}

/** Whether (x, z) is lake surface that freezes: in the basin, off the island, clear of the descent. */
export function isOverLakeIce(x: number, z: number): boolean {
    if (
        x <= LAKE_BOUNDS.minX ||
        x >= LAKE_BOUNDS.maxX ||
        z <= LAKE_BOUNDS.minZ ||
        z >= LAKE_BOUNDS.maxZ
    ) {
        return false;
    }
    const ix = x - LAKE_ISLAND.centerX;
    const iz = z - LAKE_ISLAND.centerZ;
    if (ix * ix + iz * iz <= LAKE_ISLAND_RADIUS_SQ) return false;
    return distanceToDescentSq(x, z) > HOLE_SQ;
}

let _solid = false;

/** Whether the ice currently holds weight. */
export function isLakeIceSolid(): boolean {
    return _solid;
}

/**
 * Move the ice toward `wantSolid`. Freezing waits while the player is in the
 * water beneath where the ice would form (swimming or wading, in any player
 * state): solid ice there would lift them onto it. Thawing never waits: a
 * thaw that held while someone stood on the ice would let them walk on open
 * water for as long as they kept moving. Returns the resulting state.
 */
export function updateLakeIcePhysics(
    wantSolid: boolean,
    playerX: number,
    playerZ: number,
    playerFootY: number
): boolean {
    if (wantSolid === _solid) return _solid;
    if (wantSolid && playerFootY < LAKE_ICE_Y - 0.05 && isOverLakeIce(playerX, playerZ))
        return _solid;
    _solid = wantSolid;
    return _solid;
}

/** Ground height with the ice taken into account. */
export function iceAwareGroundHeight(x: number, z: number, base: number): number {
    return _solid && base < LAKE_ICE_Y && isOverLakeIce(x, z) ? LAKE_ICE_Y : base;
}

/** Structural match for ground-system's GroundFootprintResult. */
export interface IceFootprint {
    minY: number;
    avgY: number;
    maxY: number;
    normal: { set(x: number, y: number, z: number): unknown };
}

/**
 * Footprint with the ice taken into account. Never mutates `base` (ground-system
 * caches it); writes into `out` and returns it only when the ice changes the answer.
 */
export function iceAwareFootprint<T extends IceFootprint>(
    x: number,
    z: number,
    base: T,
    out: T
): T {
    if (!_solid || base.maxY >= LAKE_ICE_Y || !isOverLakeIce(x, z)) return base;
    out.minY = LAKE_ICE_Y;
    out.avgY = LAKE_ICE_Y;
    out.maxY = LAKE_ICE_Y;
    out.normal.set(0, 1, 0);
    return out;
}

/** @internal test seam */
export function __setLakeIceSolidForTests(solid: boolean): void {
    _solid = solid;
}
