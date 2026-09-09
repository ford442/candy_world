# Fauna Framework

Ambient critters — beetles, hoppers, moths — that wander the world, scatter when
you walk into them, and settle again once you leave. This page is the whole
contract: **adding a species is one registry entry plus one geometry case.**

The framework is deliberately thin. It does not simulate motion, own rendering,
or introduce a second animation path. It sits between two layers that already
exist and decides _what state each critter is in_.

---

## 1. The layers

| Layer             | Owns                                          | Lives in                                           |
| ----------------- | --------------------------------------------- | -------------------------------------------------- |
| **Boids**         | Position + velocity for every critter         | `assembly/boids.ts`, mirrored in `boids-bridge.ts` |
| **Behaviour**     | `FaunaState` per critter, scatter impulses    | `src/systems/fauna/behavior.ts`                    |
| **Batcher**       | Drawing — 3 instanced meshes, LOD, music tint | `src/foliage/fauna-batcher.ts`                     |
| **Orchestration** | Spawn, per-frame order, teardown              | `src/systems/fauna/fauna-system.ts`                |

The boid slab (8 floats per critter: `pos xyz`, `vel xyz`, `phase`, `species`)
is the single source of truth for where a critter is. The behaviour runner
reads that slab and writes back **at most a velocity nudge** — never a position.
That keeps one integrator in charge and means the WASM, C++ and JS boid paths
all behave identically under the state machine.

Per frame, in `FaunaSystem.update()`:

```
boids step  →  behaviour runner  →  pose/matrix write  →  batcher.syncMatrices()
```

The runner goes _after_ the boids step so it sees this frame's positions; its
velocity writes are consumed by the next step.

---

## 2. States

```ts
enum FaunaState {
    Wander = 0,
    Flee = 1,
    Rest = 2,
    Perch = 3,
}
```

| State      | Meaning                               | What the runner does                           |
| ---------- | ------------------------------------- | ---------------------------------------------- |
| **Wander** | Roaming — the default                 | Nothing. Boid rules run untouched.             |
| **Flee**   | Running from the player               | One radial impulse on entry, then a hold timer |
| **Rest**   | Settled on the ground (idle)          | Damps velocity every frame                     |
| **Perch**  | Settled on a roost/prop — flyers only | Damps velocity every frame                     |

Values are persisted by the native ECS codec (`components.ts`), so **append new
states; never renumber existing ones.**

### The scatter trigger

Two radii, not one:

- **`scatterRadius`** — the player crossing this flips the critter to Flee and
  fires a single impulse away from them.
- **`calmRadius`** — Flee cannot end until the critter is _beyond_ this and its
  `fleeDuration` timer has run out.

The gap between them is a hysteresis band. Without it, a critter sitting on the
boundary re-triggers every frame and jitters in place, so `registerFaunaSpecies`
warns when `calmRadius <= scatterRadius`.

A `scatterCooldown` additionally rate-limits repeat impulses on the same
critter, so walking slowly through a flock does not accumulate velocity.

---

## 3. Adding a species

### Step 1 — Add the enum value

`src/systems/fauna/types.ts`. Append; the value is written into slot 7 of the
boid slab and read back by the batcher.

```ts
export enum FaunaSpecies {
    GumdropBeetle = 0,
    JellybeanHopper = 1,
    SugarMoth = 2,
    LicoriceSnail = 3, // ← new
}
```

### Step 2 — Register a behaviour profile

`src/systems/fauna/behavior.ts`, next to the built-ins. Every field is required;
there are no implicit defaults, so the tuning of a species is readable in one
place.

```ts
registerFaunaSpecies({
    species: FaunaSpecies.LicoriceSnail,
    label: 'Licorice Snail',
    scatterRadius: 2.0, // slow — lets you get close
    calmRadius: 4.5, // must exceed scatterRadius
    scatterImpulse: 1.2, // m/s away from the player
    scatterLift: 0, // no hop; it is a snail
    fleeDuration: 3.0, // stays spooked a while
    scatterCooldown: 2.0,
    canPerch: false, // Rest instead of Perch when it settles
    settleChancePerSecond: 0.4,
    settleDurationMin: 3.0,
    settleDurationMax: 9.0,
    settleDamping: 0.7, // per-frame velocity multiplier while settled
});
```

A species with **no** profile still spawns and roams — it simply never reacts.
That is the intended failure mode: a missing profile costs behaviour, not boot.

### Step 3 — Geometry and colour

`src/foliage/fauna-batcher.ts`: add a case to `createSpeciesGeometry()` and an
entry to `SPECIES_COLORS` / `SPECIES_LABELS`. Use the shared candy material
helper so the new species inherits clearcoat and the music tint — do **not**
build a bespoke material.

The batcher allocates one `InstancedMesh` per species capped at
`MAX_PER_SPECIES`; the loop in `init()` is driven by species count, so bump it
if you are adding beyond index 2.

### Step 4 — Motion in the boids layer (optional)

If the species needs a distinct gait, add cases in **both**
`assembly/boids.ts` and the JS mirror in `boids-bridge.ts`:
`maxSpeedForSpecies`, `groundOffsetForSpecies`, `applyGroundFollow`. These two
must stay in lockstep — the JS path is what runs when WASM is unavailable, and
a divergence shows up as fauna that moves differently on fallback hardware.

Then `npm run build:wasm`.

### Step 5 — Spawn density

`src/core/config/fauna.ts`: add the species to each `biomeDensity` entry. The
density record is per-biome and drives both the terrain scatter and the
sky-island roosts.

### Step 6 — Clips (only for hero fauna)

Skip this for anything the batcher draws. See §5.

### Checklist

- [ ] `FaunaSpecies` enum value appended (never renumbered)
- [ ] `registerFaunaSpecies({ ... })` profile, `calmRadius > scatterRadius`
- [ ] Geometry + colour + label in `fauna-batcher.ts`
- [ ] Gait cases mirrored in `assembly/boids.ts` **and** `boids-bridge.ts`
- [ ] `biomeDensity` entries in `src/core/config/fauna.ts`
- [ ] `npm run build:wasm && npm run test:fauna`
- [ ] Verified with `?no_fauna` — species disappears entirely

---

## 4. What the framework will not do for you

- **It will not move a critter.** Writing `position` on a batched instance does
  nothing; the instance matrix is rebuilt from the slab every frame. Change the
  slab, or change the boid rules.
- **It will not tint a material.** Fauna materials are shared and registered
  with the music-reactivity system (`registerReactiveMaterial`). Mutating one
  tints every critter of that species. Channel energy already reaches fauna
  through the existing accumulators in `music-reactivity.ts` — do not add a
  fauna-specific accumulator, and do not fork the existing ones.
- **It will not allocate per frame.** `FaunaBehaviorRunner.update()` runs a
  plain indexed loop over pre-sized `Float32Array` timers. `tests/fauna-behavior.test.ts`
  asserts a zero-allocation steady state; keep new logic allocation-free.

---

## 5. Opt-in extras

Both are off or absent by default; the batched swarm never touches either.

### Physical reaction (rigid bodies)

When at least one critter scatters in a frame, the runner calls a
`FaunaScatterSink` with the centroid of the burst. `FaunaSystem` wires that to
`applyRigidBodyRadialImpulse`, so nearby dynamic props get shoved when you
startle a flock. The rigid-body module is imported lazily — when that layer is
absent or `CONFIG.fauna.behavior.rigidBodyBump` is false, the sink stays null
and scatter remains purely visual.

Tests install their own sink via `setFaunaScatterSink()`.

### Hero clips (skeletal animation)

`fauna-clips.ts` maps `FaunaState` → clip name (`walk` / `flee` / `idle` /
`perch`) for **named, non-batched** rigs only. This is opt-in and count-capped
(`CONFIG.fauna.behavior.heroClips.maxRigs`) because each rig costs a mixer tick
and a skinned draw call. The instanced swarm stays on the batcher pose path
forever — see `docs/HERO_ANIMATION.md` § "Hero vs batch".

---

## 6. Config and kill switch

```ts
CONFIG.fauna = {
    enabled, maxInstances, maxPerSpecies, seed, areaScale,
    biomeDensity: { <biome>: { beetle, hopper, moth } },
    roosts:   { enabled, perIsland, ringInset, jitter, density },
    behavior: {
        enabled,          // false = pure boids, no state machine
        seed,             // settle rolls; a session replays identically
        rigidBodyBump, bumpRadius, bumpStrength,
        heroClips: { enabled, maxRigs },
    },
};
```

**`?no_fauna` is the kill switch** and it is absolute: `FEATURE_FLAGS.fauna` is
checked in `FaunaSystem.init()` before anything is allocated, so spawn, tick and
draw are all skipped — no boid buffer, no instanced meshes, no state machine.

---

## 7. Observability

- **`window.__worldHealth.sceneObjects.fauna`** — live critter count, published
  by `FaunaSystem` on init and cleared on dispose. `0` under `?no_fauna`, which
  is what the smoke test asserts.
- **`FaunaSystem.getInstance().behaviorStats`** — last frame's histogram
  (`roam` / `flee` / `perch` / `idle` / `scattered`). Null when the state
  machine is off.
- **`?debug_fauna`** — the existing per-critter debug overlay.

---

## 8. Tests

```bash
npm run test:fauna     # state machine, ~1s, no WASM or renderer needed
npm run test:wasm      # boid bounds
npm run test           # smoke — boot + world health
```

`tests/fauna-behavior.test.ts` drives the runner against a hand-built slab, so
it covers the scatter trigger, the hysteresis band, the settle cycle, the
scatter sink and the allocation budget without booting the app. Run it with
`NODE_OPTIONS=--expose-gc` for the strict zero-allocation assertion.
