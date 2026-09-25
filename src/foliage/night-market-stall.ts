import * as THREE from 'three';
import { nightMarketBatcher } from './night-market-batcher.ts';
import type { FoliageObject } from './types.ts';

export interface NightMarketStallParams {
    /** Stall tint (hex). */
    color?: number;
    /** Palette index into NIGHT_MARKET_TINTS when `color` is omitted. */
    variant?: number;
    /** Display name shown on the discovery stamp toast. */
    name?: string;
}

/**
 * Festival Night Market stall (#1758). Lightweight logic proxy — visuals live in
 * {@link nightMarketBatcher}. Registered on placement, released by
 * `ChunkStreamer` eviction through `nightMarketBatcher.removeInstance`.
 */
export function createNightMarketStall(params: NightMarketStallParams = {}): FoliageObject {
    const group = new THREE.Group();
    group.userData.type = 'night_market_stall';
    group.userData.biome = 'night_market';
    group.userData.isBatched = true;
    group.userData.radius = 1.8; // physics / cull estimate
    group.userData.interactionText = params.name ?? 'Night Market Stall';
    group.userData.stallName = params.name ?? 'Night Market Stall';

    group.userData.onPlacement = () => {
        group.userData.onPlacement = null;
        nightMarketBatcher.register(group, { color: params.color, variant: params.variant });
    };

    return group as unknown as FoliageObject;
}
