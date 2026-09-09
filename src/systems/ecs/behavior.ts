/**
 * Behavior attachment layer — a thin convention on top of the existing ECS
 * (`src/systems/ecs/world.ts`), not a replacement for it.
 *
 * A behavior is a small, named, per-entity object with an enable/tick/disable
 * lifecycle. Behaviors are registered by type once at module load and attached
 * per entity at spawn time:
 *
 *     registerBehaviorType('bob', createBobBehavior);
 *     addBehavior(entity, 'bob', { object: mesh, amplitude: 0.2 });
 *
 * The host keeps a dense tick list. `tickBehaviors()` allocates nothing:
 * no closures, no iterators, no temporary arrays — a plain indexed loop over
 * pre-built slots, with adds/removes that land during a tick deferred into
 * pre-grown scratch arrays.
 *
 * ECS interaction: every entity with at least one behavior carries a single
 * `behavior` component listing its behavior type names. That is deliberately
 * ONE component name, so the C++ bitmask query path spends exactly one of its
 * 32 bits regardless of how many behavior types exist. The component is
 * JS-only (no native codec) — it goes through `World`'s marker-slab path.
 *
 * See docs/BEHAVIORS.md for when to reach for a behavior versus `userData`
 * versus a batcher uniform.
 */

import type { Entity } from './types.ts';
import type { World } from './world.ts';

/** ECS component name carrying the behavior list for an entity. */
export const BEHAVIOR_COMPONENT = 'behavior';

/** Graphics tiers a behavior can be gated on, cheapest first. */
export type BehaviorQuality = 'low' | 'medium' | 'high';

const QUALITY_ORDER: Record<BehaviorQuality, number> = { low: 0, medium: 1, high: 2 };

/** Component shape stored on the ECS entity. Serializable by design. */
export interface BehaviorComponent {
    /** Behavior type names currently attached, in attach order. */
    types: string[];
}

/**
 * A per-entity behavior instance.
 *
 * `tick` runs every frame while the behavior is active and MUST NOT allocate:
 * no object/array literals, no `new`, no closures. Cache scratch objects on
 * the instance in the factory or in `onEnable`.
 */
export interface Behavior {
    /** Called once when the behavior is attached (or re-activated by quality). */
    onEnable?(): void;
    /** Per-frame update. `dt` is clamped frame delta in seconds; `time` is game time. */
    tick(dt: number, time: number): void;
    /** Called once when detached (or deactivated by quality). Must restore state. */
    onDisable?(): void;
}

/** Options bag handed to a behavior factory. Behavior-specific. */
export type BehaviorOptions = Record<string, any>;

/** Builds a behavior instance for an entity. Runs once, at attach time. */
export type BehaviorFactory = (entity: Entity, options: BehaviorOptions) => Behavior;

interface BehaviorTypeDef {
    factory: BehaviorFactory;
    /** Lowest graphics tier this behavior runs at. Defaults to 'low' (always on). */
    minQuality: BehaviorQuality;
}

interface BehaviorSlot {
    entity: Entity;
    type: string;
    instance: Behavior;
    /** False while quality-gated off — the slot stays in the list but is skipped. */
    active: boolean;
    /** False once detached; a dead slot is swap-removed at the end of the tick. */
    alive: boolean;
}

const types = new Map<string, BehaviorTypeDef>();

/** Dense tick list. Order is not stable across removals (swap-remove). */
const slots: BehaviorSlot[] = [];
/** entity → (behavior type → index into `slots`). Written on attach/detach only. */
const index = new Map<Entity, Map<string, number>>();

let currentQuality: BehaviorQuality = 'high';
let world: World | null = null;

// Deferred-mutation scratch. Grown on demand, never re-allocated per frame.
let ticking = false;
const pendingDetachEntity: Entity[] = [];
const pendingDetachType: string[] = [];
let pendingDetachCount = 0;

// ============================================================================
// Registration
// ============================================================================

/**
 * Bind the behavior host to the ECS world that owns the entities.
 * Optional: behaviors tick fine without a world, but the `behavior` component
 * (and therefore serialization / queries) is only written when one is bound.
 */
export function setBehaviorWorld(w: World | null): void {
    world = w;
}

/** Register a behavior type. Idempotent for the same factory; last one wins. */
export function registerBehaviorType(
    type: string,
    factory: BehaviorFactory,
    minQuality: BehaviorQuality = 'low'
): void {
    types.set(type, { factory, minQuality });
}

export function unregisterBehaviorType(type: string): void {
    types.delete(type);
}

export function hasBehaviorType(type: string): boolean {
    return types.has(type);
}

// ============================================================================
// Attach / detach
// ============================================================================

/**
 * Attach a behavior to an entity. No-op (with a warning) for an unknown type,
 * and a no-op when the entity already carries that behavior.
 */
export function addBehavior(entity: Entity, type: string, options: BehaviorOptions = {}): boolean {
    const def = types.get(type);
    if (!def) {
        console.warn(`[Behaviors] Unknown behavior type "${type}" — did you registerBehaviorType()?`);
        return false;
    }

    let byType = index.get(entity);
    if (byType?.has(type)) return false;
    if (!byType) {
        byType = new Map();
        index.set(entity, byType);
    }

    const instance = def.factory(entity, options);
    const active = QUALITY_ORDER[currentQuality] >= QUALITY_ORDER[def.minQuality];
    const slot: BehaviorSlot = { entity, type, instance, active, alive: true };

    byType.set(type, slots.length);
    slots.push(slot);

    if (active) instance.onEnable?.();
    syncComponent(entity);
    return true;
}

/** Detach one behavior. Safe to call from inside a tick (deferred to frame end). */
export function removeBehavior(entity: Entity, type: string): boolean {
    const byType = index.get(entity);
    const slotIndex = byType?.get(type);
    if (slotIndex === undefined) return false;

    const slot = slots[slotIndex];
    if (!slot.alive) return false;

    if (slot.active) slot.instance.onDisable?.();
    slot.alive = false;

    if (ticking) {
        // Compact after the loop so indices stay valid mid-tick.
        if (pendingDetachCount < pendingDetachEntity.length) {
            pendingDetachEntity[pendingDetachCount] = entity;
            pendingDetachType[pendingDetachCount] = type;
        } else {
            pendingDetachEntity.push(entity);
            pendingDetachType.push(type);
        }
        pendingDetachCount++;
        return true;
    }

    compactSlot(slotIndex);
    syncComponent(entity);
    return true;
}

/** Detach every behavior on an entity. Call before destroying the entity. */
export function removeAllBehaviors(entity: Entity): void {
    const byType = index.get(entity);
    if (!byType) return;
    // Snapshot the names: removeBehavior mutates `byType`.
    const names = Array.from(byType.keys());
    for (let i = 0; i < names.length; i++) {
        removeBehavior(entity, names[i]);
    }
}

export function hasBehavior(entity: Entity, type: string): boolean {
    const slotIndex = index.get(entity)?.get(type);
    return slotIndex !== undefined && slots[slotIndex].alive;
}

export function getBehavior<T extends Behavior = Behavior>(entity: Entity, type: string): T | undefined {
    const slotIndex = index.get(entity)?.get(type);
    if (slotIndex === undefined) return undefined;
    const slot = slots[slotIndex];
    return slot.alive ? (slot.instance as T) : undefined;
}

/** Behavior type names attached to an entity (fresh array — not for hot paths). */
export function listBehaviors(entity: Entity): string[] {
    const byType = index.get(entity);
    if (!byType) return [];
    const out: string[] = [];
    for (const [type, slotIndex] of byType) {
        if (slots[slotIndex].alive) out.push(type);
    }
    return out;
}

// ============================================================================
// Tick
// ============================================================================

/**
 * Tick every active behavior. Zero allocation: indexed loop, no closures,
 * no iterators, no temporaries.
 */
export function tickBehaviors(dt: number, time: number): void {
    ticking = true;
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (!slot.alive || !slot.active) continue;
        slot.instance.tick(dt, time);
    }
    ticking = false;

    if (pendingDetachCount > 0) {
        for (let i = 0; i < pendingDetachCount; i++) {
            const entity = pendingDetachEntity[i];
            const slotIndex = index.get(entity)?.get(pendingDetachType[i]);
            if (slotIndex !== undefined) compactSlot(slotIndex);
            syncComponent(entity);
        }
        pendingDetachCount = 0;
    }
}

/**
 * Set the graphics tier. Behaviors above the tier are disabled (their
 * `onDisable` restores state) and re-enabled when the tier comes back up.
 */
export function setBehaviorQuality(quality: BehaviorQuality): void {
    if (quality === currentQuality) return;
    currentQuality = quality;
    const level = QUALITY_ORDER[quality];
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (!slot.alive) continue;
        const def = types.get(slot.type);
        const shouldRun = def ? level >= QUALITY_ORDER[def.minQuality] : true;
        if (shouldRun === slot.active) continue;
        slot.active = shouldRun;
        if (shouldRun) slot.instance.onEnable?.();
        else slot.instance.onDisable?.();
    }
}

export function getBehaviorQuality(): BehaviorQuality {
    return currentQuality;
}

/** Live behavior instance count — for HUD/debug counters and tests. */
export function getBehaviorCount(): number {
    return slots.length;
}

/** Drop every behavior and registration. Test/teardown only. */
export function resetBehaviors(): void {
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot.alive && slot.active) slot.instance.onDisable?.();
    }
    slots.length = 0;
    index.clear();
    types.clear();
    pendingDetachCount = 0;
    ticking = false;
    currentQuality = 'high';
    world = null;
}

// ============================================================================
// Private
// ============================================================================

/** Swap-remove `slotIndex`, repairing the moved slot's index entry. */
function compactSlot(slotIndex: number): void {
    const slot = slots[slotIndex];
    const byType = index.get(slot.entity);
    byType?.delete(slot.type);
    if (byType && byType.size === 0) index.delete(slot.entity);

    const last = slots.length - 1;
    if (slotIndex !== last) {
        const moved = slots[last];
        slots[slotIndex] = moved;
        index.get(moved.entity)?.set(moved.type, slotIndex);
    }
    slots.pop();
}

/**
 * Mirror the entity's behavior list onto its `behavior` ECS component so
 * queries and save/serialization can see it. Attach/detach only — never ticks.
 */
function syncComponent(entity: Entity): void {
    if (!world) return;
    const names = listBehaviors(entity);
    if (names.length === 0) {
        if (world.hasComponent(entity, BEHAVIOR_COMPONENT)) {
            world.removeComponent(entity, BEHAVIOR_COMPONENT);
        }
        return;
    }
    const existing = world.getComponent<BehaviorComponent>(entity, BEHAVIOR_COMPONENT);
    if (existing) {
        existing.types = names;
        world.setComponent(entity, BEHAVIOR_COMPONENT, existing);
    } else {
        world.addComponent<BehaviorComponent>(entity, BEHAVIOR_COMPONENT, { types: names });
    }
}
