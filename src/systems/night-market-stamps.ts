/**
 * Festival Night Market gameplay hooks (#1758).
 *
 * - Discovery stamps: walk up to a stall after dusk to collect its stamp.
 * - Chord Strike: firing Chord Strike at night stamps every stall in the beam
 *   radius and awakens nearby awakenable flora through the existing
 *   awakened-persistence store.
 *
 * No new persistence store: a stamp is a regular discovery id
 * (`night_market_stamp:<entity id>`) keyed by the stall's map / snapshot id,
 * so it rides the existing discovery persistence + save file.
 */
import type * as THREE from 'three';
import { nightMarketBatcher } from '../foliage/night-market-batcher.ts';
import { awakenedPersistence } from './awakened-persistence-api.ts';
import { BiomeUniforms } from './biome-uniforms.ts';
import { discoverySystem } from './discovery.ts';

export const NIGHT_MARKET_STAMP_PREFIX = 'night_market_stamp:';
/** First-visit discovery for the market as a whole. */
export const NIGHT_MARKET_DISCOVERY_ID = 'night_market';
/** Metres from a stall's pivot at which its stamp is collected. */
export const NIGHT_MARKET_STAMP_RADIUS = 4.0;
/** Circadian phase (0 night … 1 day) below which the market is trading. */
export const NIGHT_MARKET_OPEN_PHASE = 0.5;
/** Proximity checks run at this interval, not every frame. */
const STAMP_CHECK_INTERVAL_S = 0.25;
/** Flora types the chord-strike hook tries to awaken (must be AWAKENABLE_TYPES). */
const CHORD_AWAKEN_TYPES = ['luminous_plant', 'gem_canopy_tree'] as const;

/** Minimal discovery surface — injectable so Node tests avoid the toast DOM. */
export interface StampSink {
    discover(id: string, displayName: string, icon?: string): boolean;
    isDiscovered(id: string): boolean;
}

/** Minimal stall source — the batcher in production. */
export interface StallSource {
    readonly instanceCount: number;
    getStall(i: number): THREE.Object3D | undefined;
}

let _sink: StampSink = discoverySystem;
let _stalls: StallSource = nightMarketBatcher;
let _sinceCheck = 0;

/** Test seam. Pass nothing to restore the production wiring. */
export function __setNightMarketStampDeps(
    deps: { sink?: StampSink; stalls?: StallSource } = {}
): void {
    _sink = deps.sink ?? discoverySystem;
    _stalls = deps.stalls ?? nightMarketBatcher;
    _sinceCheck = 0;
}

export function isNightMarketOpen(circadianPhase: number): boolean {
    return circadianPhase < NIGHT_MARKET_OPEN_PHASE;
}

/** Stable stamp id for a stall: its map / snapshot id. Null for unidentified stalls. */
export function stampIdForStall(stall: THREE.Object3D): string | null {
    const id = stall.userData?.persistentId ?? stall.userData?.mapEntityId;
    return typeof id === 'string' && id.length > 0 ? NIGHT_MARKET_STAMP_PREFIX + id : null;
}

function stampStall(stall: THREE.Object3D): boolean {
    const id = stampIdForStall(stall);
    if (!id || _sink.isDiscovered(id)) return false;
    if (!_sink.isDiscovered(NIGHT_MARKET_DISCOVERY_ID)) {
        _sink.discover(NIGHT_MARKET_DISCOVERY_ID, 'Festival Night Market', '🏮');
    }
    const name =
        typeof stall.userData?.stallName === 'string' ? stall.userData.stallName : 'Market Stall';
    return _sink.discover(id, `${name} Stamp`, '🏮');
}

function stampWithin(x: number, z: number, radius: number): number {
    const r2 = radius * radius;
    let stamped = 0;
    for (let i = 0; i < _stalls.instanceCount; i++) {
        const stall = _stalls.getStall(i);
        if (!stall) continue;
        const dx = stall.position.x - x;
        const dz = stall.position.z - z;
        if (dx * dx + dz * dz <= r2 && stampStall(stall)) stamped++;
    }
    return stamped;
}

/**
 * Per-frame hook. Zero-allocation; throttled to STAMP_CHECK_INTERVAL_S.
 * Returns the number of stamps collected this call.
 */
export function updateNightMarketStamps(
    delta: number,
    playerPos: { x: number; z: number },
    circadianPhase: number
): number {
    _sinceCheck += delta;
    if (_sinceCheck < STAMP_CHECK_INTERVAL_S) return 0;
    _sinceCheck = 0;
    if (!isNightMarketOpen(circadianPhase) || _stalls.instanceCount === 0) return 0;
    return stampWithin(playerPos.x, playerPos.z, NIGHT_MARKET_STAMP_RADIUS);
}

/**
 * Chord Strike landed at `origin`. At night, stamps every stall inside the
 * beam, flares the market lanterns, and awakens nearby flora via the existing
 * awakened-persistence store. Returns the number of stamps collected.
 */
export function onNightMarketChordStrike(
    origin: THREE.Vector3,
    radius: number,
    circadianPhase: number
): number {
    if (!isNightMarketOpen(circadianPhase)) return 0;
    const stamped = stampWithin(origin.x, origin.z, radius);
    if (stamped === 0) return 0;

    // Music Impact: chord strike flares every lantern; the bindings update
    // decays it back to the tracker level over the next frames.
    BiomeUniforms.nightMarket.shimmer.value = 1.0;
    for (const type of CHORD_AWAKEN_TYPES) {
        awakenedPersistence.tryAwakenNearby(type, origin, 1.0);
    }
    return stamped;
}

/** Number of stall stamps collected so far. */
export function getNightMarketStampCount(
    ids: readonly string[] = discoverySystem.getDiscoveredIds()
): number {
    let n = 0;
    for (const id of ids) if (id.startsWith(NIGHT_MARKET_STAMP_PREFIX)) n++;
    return n;
}
