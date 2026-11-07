// src/systems/bounce-shrooms.ts
//
// Source of the `bounce_shroom` item (Groove Boots, #1976 slice A): a trampoline
// mushroom the player has bounced on BOUNCES_TO_RIPEN times ripens, and can be
// harvested once. Harvested mushrooms are remembered by site (unlockSystem), so
// they stay spent across reloads; bounce counts in between do not persist.

import type * as THREE from 'three';
import { announce } from '../ui/announcer.ts';
import { unlockSystem } from './unlocks.ts';

export const BOUNCES_TO_RIPEN = 3;
/** Bounces closer together than this (sim ms) are one bounce. */
const BOUNCE_COOLDOWN_MS = 400;
const DEFAULT_REACH = 3;
const BOUNCE_JUMP_TEXT = '🚀 Jump!';
const BOUNCE_HARVEST_TEXT = '🥾 Harvest Bounce Shroom';

/** A trampoline foliage object (`FoliageObject`, or a stand-in in tests). */
type BounceTarget = Pick<THREE.Object3D, 'position' | 'userData'>;

/** Persisted id of a mushroom: its rounded position (world generation is seeded). */
export function bounceShroomSiteId(shroom: BounceTarget): string {
    return `bounce_shroom:${Math.round(shroom.position.x)},${Math.round(shroom.position.z)}`;
}

/** Nearest trampoline mushroom whose footprint contains (x, z). */
export function findBouncedMushroom(
    x: number,
    z: number,
    trampolines: ArrayLike<BounceTarget>
): BounceTarget | null {
    let best: BounceTarget | null = null;
    let bestDistSq = Infinity;
    for (let i = 0; i < trampolines.length; i++) {
        const obj = trampolines[i];
        if (!obj || obj.userData.type !== 'mushroom') continue;
        const reach = (obj.userData.radius ?? DEFAULT_REACH) as number;
        const dx = x - obj.position.x;
        const dz = z - obj.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq <= reach * reach && distSq < bestDistSq) {
            best = obj;
            bestDistSq = distSq;
        }
    }
    return best;
}

/**
 * Count one bounce on the mushroom under (x, z). Returns true when this bounce
 * ripened it.
 */
export function recordMushroomBounce(
    x: number,
    z: number,
    trampolines: ArrayLike<BounceTarget>,
    nowMs: number
): boolean {
    const shroom = findBouncedMushroom(x, z, trampolines);
    if (!shroom) return false;
    const ud = shroom.userData;
    if (ud.bounceHarvested || ud.bounceRipe) return false;
    if (unlockSystem.isSiteHarvested(bounceShroomSiteId(shroom))) {
        ud.bounceHarvested = true;
        return false;
    }
    if (nowMs - (ud.lastBounceMs ?? -Infinity) < BOUNCE_COOLDOWN_MS) return false;
    ud.lastBounceMs = nowMs;
    ud.bounceCount = (ud.bounceCount ?? 0) + 1;
    if (ud.bounceCount < BOUNCES_TO_RIPEN) return false;

    ud.bounceRipe = true;
    ud.interactionText = BOUNCE_HARVEST_TEXT;
    ud.onInteract = () => harvestBounceShroom(shroom);
    announce(
        'This mushroom is ripe. Look at it and interact to harvest a bounce shroom.',
        'polite'
    );
    return true;
}

export function harvestBounceShroom(shroom: BounceTarget): boolean {
    const ud = shroom.userData;
    if (!ud.bounceRipe || ud.bounceHarvested) return false;
    ud.bounceHarvested = true;
    ud.bounceRipe = false;
    ud.interactionText = BOUNCE_JUMP_TEXT;
    ud.onInteract = undefined;
    unlockSystem.markSiteHarvested(bounceShroomSiteId(shroom));
    unlockSystem.harvest('bounce_shroom', 1, 'Bounce Shroom');
    return true;
}
