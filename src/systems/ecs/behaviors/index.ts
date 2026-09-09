/**
 * Built-in behaviors and their registration.
 *
 * `registerBuiltinBehaviors()` is idempotent and called from the game loop's
 * first behavior tick, so callers can `addBehavior(entity, 'bob', …)` without
 * worrying about init order.
 */

import { loadStartupProfile } from '../../../core/startup-profile.ts';
import {
    registerBehaviorType,
    hasBehaviorType,
    setBehaviorQuality,
    setBehaviorWorld,
    tickBehaviors,
} from '../behavior.ts';
import { World } from '../world.ts';
import { createBobBehavior } from './bob.ts';
import { createInteractHighlightBehavior } from './interact-highlight.ts';

export type { BobOptions } from './bob.ts';
export type { InteractHighlightOptions } from './interact-highlight.ts';
export { createBobBehavior } from './bob.ts';
export { createInteractHighlightBehavior } from './interact-highlight.ts';

let registered = false;

export function registerBuiltinBehaviors(): void {
    if (registered) return;
    registered = true;
    // Bob is cheap enough for every tier; the highlight touches materials, so
    // it sits out the `low` tier where props are batched or impostored anyway.
    registerBehaviorType('bob', createBobBehavior, 'low');
    registerBehaviorType('interact', createInteractHighlightBehavior, 'medium');
}

/** Test/teardown helper — lets `resetBehaviors()` be followed by re-registration. */
export function resetBuiltinBehaviorRegistration(): void {
    registered = false;
}

export function areBuiltinBehaviorsRegistered(): boolean {
    return registered && hasBehaviorType('bob') && hasBehaviorType('interact');
}

// ============================================================================
// System bootstrap
// ============================================================================

/**
 * The World that owns behavior-carrying entities.
 *
 * This is a second `World` handle alongside `FaunaSystem`'s — same pattern the
 * fauna system and the ECS benchmark already use. Entity IDs come from the C++
 * world when Emscripten is up, so the handles never hand out colliding IDs, and
 * fauna keeps using its own native codecs untouched.
 */
let boundWorld: World | null = null;
let systemReady = false;

/** Create/bind the behavior world and register the built-ins. Idempotent. */
export function initBehaviorSystem(): World {
    registerBuiltinBehaviors();
    if (!boundWorld) {
        boundWorld = new World();
        setBehaviorWorld(boundWorld);
    }
    if (!systemReady) {
        systemReady = true;
        // Behaviors are quality-gated off the persisted graphics level; `ultra`
        // shares the `high` behavior set.
        const graphics = loadStartupProfile().graphics;
        setBehaviorQuality(graphics === 'ultra' ? 'high' : graphics);
    }
    return boundWorld;
}

export function getBehaviorWorld(): World | null {
    return boundWorld;
}

/**
 * Game-loop entry point: lazily boots the system, then ticks it.
 * `time` is the beat-scaled game time so bobbing stays in step with the music.
 */
export function updateBehaviorSystem(dt: number, time: number): void {
    if (!systemReady) initBehaviorSystem();
    tickBehaviors(dt, time);
}
