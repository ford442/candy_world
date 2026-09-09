# Entity Behaviors

Candy World has three ways to make a thing in the world move, glow, or react.
Picking the wrong one is the most common source of frame-time regressions and
of logic that nobody can find later, so this document is the decision rule.

The behavior layer itself is a thin convention on top of the **existing** ECS
(`src/systems/ecs/world.ts`). It does not replace it, does not own rendering,
and does not know about batchers.

---

## 1. Pick an attachment style

| | **Batcher / TSL uniform** | **Behavior** | **`userData`** |
|---|---|---|---|
| Use when | The prop is drawn by an instanced batcher, or its motion/glow is a pure function of time, position and audio uniforms | The prop is a one-off `Object3D` with per-instance JS state and a lifecycle (enable → tick → disable) | You need to hang a plain fact on an object: a type name, a radius, a callback |
| Cost | Free per instance — the GPU does the work for thousands | One JS function call per frame per instance | Zero, until something loops over the scene graph to read it |
| Scales to | 10,000+ | ~100s | n/a |
| Lives in | `src/foliage/*-batcher.ts`, `src/systems/wind-uniforms.ts`, `src/foliage/plant-pose-machine.ts` | `src/systems/ecs/behaviors/` | The object |

**Rules of thumb**

- **Anything a batcher draws stays with the batcher.** Writing `position.y` on a
  batched prop does nothing (the instance matrix is the source of truth) or
  costs a matrix upload per frame. Move the motion into the batcher's animation
  batch or a TSL node instead.
- **Anything driven purely by a shared material stays in TSL.** A shared/cached
  material (`getCachedProceduralMaterial`, tagged `material.userData.shared`)
  is reused by every prop of that species — mutating it tints all of them. A
  material with an `emissiveNode` ignores `.emissive` entirely.
- **`userData` is for data, not for behavior.** Storing
  `userData.animationType = 'bounce'` makes the *game loop* responsible for
  switching on a string every frame for every object. For new non-batched props,
  attach a behavior instead (see the deprecation note below).
- **Fauna keeps its existing ECS path.** Fauna components use fixed-stride
  native codecs (`src/systems/fauna/components.ts`) so the C++ bitmask query can
  see them. Behaviors are not a replacement for that and do not touch it.

---

## 2. Using behaviors

```ts
import { initBehaviorSystem } from '../systems/ecs/behaviors/index.ts';
import { addBehavior, removeAllBehaviors } from '../systems/ecs/behavior.ts';

const world = initBehaviorSystem();       // idempotent; registers the built-ins
const entity = world.createEntity();

addBehavior(entity, 'bob', {
    object: prop,
    amplitude: 0.2,
    speed: 0.4,
    phase: Math.random() * Math.PI * 2,   // desynchronise siblings
});

addBehavior(entity, 'interact', { object: prop, color: 0xfff0d0 });

// On despawn — always, or the behavior keeps ticking a dead prop:
removeAllBehaviors(entity);
world.destroyEntity(entity);
```

The game loop ticks the whole list once per frame from `src/core/game-loop.ts`
(`updateBehaviorSystem`), right after fauna and before the hero mixer.

### Writing a behavior

```ts
export interface Behavior {
    onEnable?(): void;          // capture base state here
    tick(dt: number, time: number): void;
    onDisable?(): void;         // restore base state here — always
}
```

Then register the type once, at module load:

```ts
registerBehaviorType('myThing', createMyThingBehavior, 'medium');
//                                                      ^ lowest graphics tier
```

**`tick` must not allocate.** No object or array literals, no `new`, no
closures, no `Array.prototype` methods that build a result. Cache every scratch
value on the instance in the constructor or `onEnable`. `tests/behaviors.test.ts`
enforces this: 200 live behaviors × 20,000 ticks must add ~0 bytes of steady
heap.

**`onDisable` must restore.** It runs on detach *and* whenever the graphics tier
drops below the behavior's minimum, so a behavior that leaves the prop mid-pose
will visibly freeze it there.

### Quality gating

Each behavior type declares the lowest graphics tier it runs at. The tier is
read from the persisted startup profile at boot, and `setBehaviorQuality()`
re-evaluates every live behavior: those going out of range get `onDisable()`,
those coming back get `onEnable()`. Gated-off behaviors stay in the list and are
skipped by a single boolean check — no re-allocation on either transition.

### Built-ins

| Type | Tier | What it does |
|---|---|---|
| `bob` | `low` | Vertical bob (+ optional roll) on a **non-batched** prop. Restores the original pose on detach. |
| `interact` | `medium` | Emissive highlight while the player gazes at / stands near the prop. Chains onto the existing `interaction.ts` `onGazeEnter`/`onProximityEnter` hooks rather than adding a second picking path, and skips shared or TSL-driven materials. |

---

## 3. Relationship to the ECS

Every entity with at least one behavior carries a single `behavior` component
listing its behavior type names:

```ts
{ types: ['bob', 'interact'] }
```

That is written on attach/detach only — **never during a tick** — so the tick
loop stays free of ECS calls, and so save/serialization can list an entity's
behaviors without a second registry.

### C++ bitmask path

The C++ ECS query uses a 32-bit component mask, so component *names* are a
scarce resource. The behavior layer deliberately spends **exactly one bit**
(`behavior`) no matter how many behavior types exist — the type names live
inside the component payload, not in the mask. Adding a new behavior type
therefore costs zero bits and needs no C++ change.

`behavior` is a JS-only component: it has no `NativeComponentCodec`, so
`World` registers it through the existing 1-byte marker-slab path. Fauna's
fixed-stride codecs are untouched.

---

## 4. Cookbook

### ✅ New non-batched prop that floats and lights up on gaze

```ts
const entity = initBehaviorSystem().createEntity();
addBehavior(entity, 'bob', { object: group, amplitude: 0.15, phase: Math.random() * 6.28 });
addBehavior(entity, 'interact', { object: group });
group.userData.behaviorEntity = entity;   // so despawn can clean up
```

### ❌ Deprecated for this case: `userData.animationType`

```ts
// Don't do this for a NEW non-batched prop:
group.userData.animationType = 'bounce';
group.userData.animationOffset = Math.random() * 100;
```

Why: it pushes the prop's logic into a growing `switch` in
`src/foliage/animation.ts` that runs for every object every frame, and it has no
enable/disable hook, so nothing restores the pose when the prop is culled or the
quality tier drops.

**Existing props are not being migrated.** `userData.animationType` remains the
supported path for everything already using it — in particular every archetype
routed through the foliage batchers (`panningBob`, `gentleSway`, `sway`, …),
where the animation is evaluated in WASM per batch and a behavior would be
strictly slower. Migrate one only when you are already rewriting it and it is
genuinely non-batched.

### ❌ Don't use a behavior for a batched prop

```ts
// 3,000 grass blades — the batcher/wind uniforms already do this on the GPU.
addBehavior(entity, 'bob', { object: blade });
```

### ❌ Don't use a behavior to hold data

```ts
addBehavior(entity, 'biomeTag', { biome: 'lake_island' });  // no tick, no point
```

Use `userData.biome`, or a real ECS component if a system needs to query it.

---

## 5. Testing

```bash
npm run test:behaviors    # lifecycle, quality gating, ECS mirroring, allocation budget
npm run test              # smoke — boots the app and ticks the real loop
```
