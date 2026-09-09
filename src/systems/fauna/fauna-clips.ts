/**
 * Fauna state → hero clip binding.
 *
 * The bridge between `FaunaState` (set by the boids/ECS layer) and the hero
 * clip player. It exists so a fauna behaviour change is one call —
 * `syncFaunaHeroClip(rig, state)` — with no knowledge of mixers, crossfades or
 * the game loop.
 *
 * This applies **only to hero fauna**: a handful of named, non-batched
 * creatures. The instanced swarm in `FaunaSystem` stays on boids + the
 * `FaunaBatcher` pose path and never reaches this module — see
 * docs/HERO_ANIMATION.md § "Hero vs batch".
 */

import { getHeroRig, playHeroClip, stopHeroClip, type HeroRig } from '../animation/clip-player.ts';
import { FaunaState } from './types.ts';

/** Clip name each behaviour state asks for, by convention in the asset. */
export const FAUNA_STATE_CLIPS: Readonly<Record<FaunaState, string>> = {
    [FaunaState.Wander]: 'walk',
    [FaunaState.Flee]: 'flee',
    [FaunaState.Rest]: 'idle',
};

/** Played when the rig has no clip for the requested state. */
const FALLBACK_CLIP = 'idle';

/** Fleeing reads as urgent; resting should not snap. */
const FADE_BY_STATE: Readonly<Record<FaunaState, number>> = {
    [FaunaState.Wander]: 0.2,
    [FaunaState.Flee]: 0.08,
    [FaunaState.Rest]: 0.35,
};

/**
 * Last state applied per rig, so a steady state costs one map lookup a frame.
 * Keyed by name but holding the rig *instance* too: a rig re-registered under
 * the same name (respawn, hot reload) is a different mixer, and its clip must
 * be re-applied rather than skipped as already-current.
 */
const _applied = new Map<string, { state: FaunaState; rig: HeroRig }>();

/**
 * Point `rigName` at the clip for `state`. Safe to call every frame: it only
 * touches the mixer when the state actually changed.
 *
 * Returns true when the rig is now playing the state's clip (or already was).
 */
export function syncFaunaHeroClip(rigName: string, state: FaunaState, force = false): boolean {
    const last = _applied.get(rigName);

    const rig = getHeroRig(rigName);
    if (!rig) return false; // asset not streamed in yet — retry next change

    if (!force && last && last.state === state && last.rig === rig) return true;

    const wanted = FAUNA_STATE_CLIPS[state];
    const clip = rig.hasClip(wanted) ? wanted : FALLBACK_CLIP;
    if (!rig.hasClip(clip)) {
        console.warn(`[fauna-anim] "${rigName}" has neither "${wanted}" nor "${FALLBACK_CLIP}"`);
        return false;
    }

    const ok = playHeroClip(rigName, clip, { loop: true, fade: FADE_BY_STATE[state] });
    if (ok) _applied.set(rigName, { state, rig });
    return ok;
}

/** Stop a hero fauna rig and forget its state (despawn / cull). */
export function releaseFaunaHeroClip(rigName: string, fade?: number): void {
    stopHeroClip(rigName, fade);
    _applied.delete(rigName);
}

/** Last state pushed to a rig — null when it has never been synced. */
export function getFaunaHeroClipState(rigName: string): FaunaState | null {
    return _applied.get(rigName)?.state ?? null;
}

/** Test/teardown hook. */
export function resetFaunaHeroClips(): void {
    _applied.clear();
}
