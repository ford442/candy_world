# Batcher Performance Budgets

Candy World now tracks foliage batcher pressure with both build-time budgets and runtime telemetry.

## Build-time budget report

Use:

```bash
npm run budget:batchers
```

This reads `assets/map.json`, maps entity types to batchers, and reports:

- map instance count per batcher
- budgeted max instances
- utilization status (pass/warn/error)
- estimated VRAM footprint

Config lives in:

- `tools/build-optimizer/batcher-budgets.json`
- Script: `tools/build-optimizer/src/batcher-budget.ts`

## Runtime telemetry

When running with `?debug=1`, the debug panel now shows a live **Batcher Stats** section:

- total active instances / capacity
- draw-call estimate
- estimated VRAM
- top 5 most-populated batchers

Telemetry source: `src/foliage/batcher-telemetry.ts`

## Cross-batcher consolidation landed

Glowing flower placement now routes through `SimpleFlowerBatcher` instead of a separate glowing-only registration path, reducing active batcher/shader variant pressure in dense flower maps while preserving the glowing beam behavior (`forceBeam` path).

## Map-driven preallocation

`metadata.expectedInstanceCounts` can now be authored in map JSON and is exposed via `LoadedCandyMap.getExpectedInstanceCounts()`.

Generation currently uses this hint to pre-size `TreeBatcher` capacity before initialization, preventing dynamic growth spikes during startup streaming.

---

# Dynamic Rigid Bodies

The dynamic rigid-body layer (`assembly/rigidbody.ts` +
`src/systems/physics/rigid-bodies.ts`) simulates a _small_ number of bumpable
interactive props. It is deliberately not a general-purpose physics world.

## Budget

| Knob                 | Value                             | Where                                                                          |
| -------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `MAX_DYNAMIC_BODIES` | **64**                            | `assembly/constants.ts`, mirrored in `src/systems/physics/rigid-body-types.ts` |
| Bytes per body       | 64 (16 × f32)                     | `RIGID_BODY_STRIDE`                                                            |
| Total pool           | 4 KB                              | managed `StaticArray`, allocated once                                          |
| Substep              | 1/120 s, max 8 per frame          | `MAX_SUBSTEP` / `MAX_SUBSTEPS`                                                 |
| Frame delta clamp    | 0.1 s                             | `MAX_FRAME_DT` — a tab-restore hitch cannot tunnel a body                      |
| Speed clamp          | 80 u/s                            | `MAX_SPEED`                                                                    |
| Sleep threshold      | 0.28 u/s for 0.6 s while grounded | `SLEEP_LINEAR_SPEED` / `SLEEP_TIME`                                            |

64 is the cap because body-body collision is an O(n²) sweep over the high-water
mark: at 64 bodies that is ~2016 f32 pairs per substep, cheaper than maintaining
a second broadphase for this few objects. Raising the cap means adding a
broadphase first — the quadratic term is what the budget is protecting.

**Cost when unused is zero.** The pool is only allocated on the first
`initRigidBodies()`, and `updateRigidBodies()` early-outs while the body count
is 0. Nothing in the default boot path spawns a body today, so production frames
pay nothing.

**Cost when idle is near-zero.** Settled bodies sleep, and the transform sync
skips both sleeping bodies and the whole pass when `awakeCount === 0`.

## What it does

- Semi-implicit Euler with substepping, linear damping, and a speed clamp
- Sphere / vertical-capsule / AABB colliders (no rotation, no angular state)
- Terrain contacts via the unified ground height (`assembly/ground.ts`)
- Static contacts by walking the **existing** collision spatial grid — mushroom
  caps, cloud platforms, trampolines (bouncy), dynamic ferns, gate cylinders
- Body-body contacts with mass-weighted positional correction + restitution
- A **one-way** player capsule proxy: the player shoves props, props never shove
  the player. The character controller keeps sole authority over jump/dash/
  grounding, so this layer cannot regress movement.

## Non-goals

Vehicles, ragdolls, stacking towers, soft bodies, and replacing the player
controller with a generic rigid body. Joints (below), fauna physical reactions,
and debris build on top of this layer; the character controller stays on the
player capsule.

## Bounds

Bodies are hard-clamped to the same world box the particle system is asserted
against in `tests/wasm.mjs`: X ∈ [-128, 128], Y ∈ [-100, 500], Z ∈ [-128, 128]
(`RB_*` in `assembly/constants.ts`). Walls and the ceiling bounce with the
body's restitution; a non-finite position is recycled rather than allowed to
poison later contacts.

## Fallback

`src/systems/physics/rigid-body-fallback.ts` is a pure-JS mirror on the
identical flat layout, used when WASM is unavailable. It keeps integration,
terrain rest, body-body, player bumps, bounds and sleeping. It does **not** walk
the static collision grid (that lives in WASM linear memory), so props rest on
terrain but do not land on mushroom caps or cloud platforms on that path.

## Trying it

```
http://localhost:5173/?debugPhysics=1
```

Spawns 6 candy props near the player spawn, plus the joint staging area (see
below), and draws wireframe collider gizmos (pink = awake, blue = asleep). `G`
respawns everything, `B` fires a radial blast from the player — the same entry
point (`applyRigidBodyRadialImpulse`) that ability hits should use.

## Tests

```bash
npm run test:rigidbody   # tests/rigid-body.mjs — also part of test:integration
```

# Joints

The joint layer (`assembly/joints.ts` + `src/systems/physics/joints.ts`) adds
**fixed**, **hinge** and **spring** constraints on top of the rigid bodies —
enough for a candy swing, a hanging gumdrop, a trap lid or a bouncing-pad
linkage. Like the layer beneath it, it is deliberately not a general constraint
world.

## Budget

| Knob              | Value            | Where                                                                     |
| ----------------- | ---------------- | ------------------------------------------------------------------------- |
| `MAX_JOINTS`      | **64**           | `assembly/constants.ts`, mirrored in `src/systems/physics/joint-types.ts` |
| Bytes per joint   | 64 (16 × f32)    | `JOINT_STRIDE`                                                            |
| Total pool        | 4 KB             | managed `StaticArray`, allocated once                                     |
| Projection passes | 4 per substep    | `JOINT_ITERATIONS`                                                        |
| Correction clamp  | 2 units per pass | `MAX_CORRECTION`                                                          |
| Joint speed clamp | 60 u/s           | `MAX_JOINT_SPEED` — under the body layer's 80                             |

The solve is O(joints × iterations) with no islands and no graph colouring: at
64 joints × 4 passes that is 256 constraint projections per substep, which is
cheaper than the body layer's own O(n²) contact sweep sitting next to it.

**Cost when unused is zero.** The pool is allocated alongside the body pool and
`solveJoints()` early-outs while the joint count is 0. Nothing in the default
boot path creates a joint.

## What a joint _is_ here

The body layer carries no angular state, so a constraint relates two **points**,
not two frames:

- **fixed** — B keeps its bind-time offset from A (a weld)
- **hinge** — B swings on a fixed-length arm around a pivot, confined to the
  plane through that pivot whose normal is the hinge axis. That is exactly one
  rotational degree of freedom: a swing, a lid, a pendulum. A zero-length arm
  degenerates to a pin.
- **spring** — a damped distance constraint between the two body origins

Either end may be `null` (the immovable world) or a kinematic body, which also
lets gameplay move the mounting point. A joint between two immovable ends is
rejected — there would be nothing to solve.

## Solver

Position-based (PBD). Each substep runs `JOINT_ITERATIONS` projection passes and
then converts the accumulated correction back into velocity as `v += dp / h`.
That is exactly consistent with the caller's semi-implicit Euler integrator:
after integration `p = p0 + v*h`, so `(p_final - p0) / h == v + dp/h`.

Joints are solved **after** integration and environment contacts and **before**
body-body contacts, so a constraint wins over gravity for the substep while a
contact still gets the last word on penetration.

## Spring range

| Knob          | Documented range | Behaviour outside it                                                          |
| ------------- | ---------------- | ----------------------------------------------------------------------------- |
| stiffness `k` | 10 .. 4000       | clamped at 4000; below ~10 the body just sags a long way (gravity is 22 u/s²) |
| damping       | 0 .. 400         | clamped at 400; 0 oscillates forever, which is stable, not divergent          |

Springs are an explicit damped force applied at the velocity level, and both
coefficients are additionally capped per substep at the explicit-integration
stability limit (`k·h²·Σm⁻¹ ≤ 1`, `c·h·Σm⁻¹ ≤ 1`). An out-of-range `k`
therefore soft-limits rather than diverging — `tests/joints.mjs` sweeps the
range plus `k = 1e9` to hold that.

## Disabled when the body layer is off

A joint cannot outlive what it constrains:

- `rbDespawn()` calls `jointsOnBodyRemoved()`, `rbClear()` calls `jointsClear()`
  (and the fallback bridge mirrors both), so a joint never pulls on a recycled
  body slot
- the solver re-validates both endpoints and drops a joint whose body has gone
- create fails (`null`) when the body layer is unavailable, the pool is at
  `MAX_JOINTS`, a body ref is dead, or both ends are immovable

## Fallback

`src/systems/physics/joint-fallback.ts` is a pure-JS mirror on the identical
flat layout, used when WASM is unavailable. Unlike the rigid-body fallback it
has **no** behavioural gap: `tests/joint-fallback.test.mjs` reproduces the WASM
test's hinge, spring and weld results to the same printed precision.

## Trying it

`?debugPhysics=1` also stages one toy per joint type near the player spawn — a
candy swing (hinge) with a charm welded to the seat (fixed), and a gumdrop on a
spring. Constraint gizmos draw the anchor-to-anchor link in yellow and the hinge
axis in cyan. Walk into them; `G` respawns.

`window.__physicsSandbox.joints()` and `.jointErrors()` report the live count
and per-joint constraint violation from the console.

## Tests

```bash
npm run test:joints          # tests/joints.mjs — WASM solver, incl. a golden hinge step
npm run test:joint-fallback  # tests/joint-fallback.test.mjs — JS mirror parity
```

Both are part of `test:integration`.

Covers pool lifecycle and the capacity cap, settling + sleep, 20 s of 4000-unit
impulses staying in bounds and finite, radial-impulse wake, the one-way player
proxy, determinism over a 30 s run, and degenerate deltas (zero, negative, and a
5 s hitch).

---

# Soft Bodies (experimental)

`src/systems/physics/soft-body.ts` is a **prototype**, not a system: one
position-based cloth grid, opt-in behind a URL flag, used by exactly one demo
object (`src/debug/soft-body-demo.ts`). It does not feed foliage, it does not
replace the TSL wind deform in `src/foliage/material-core/deformation.ts`, and
nothing in the default boot path loads it.

## Trying it

```
http://localhost:5173/?softBody=1
```

A candy banner hangs on a rod near the player spawn. Walk through it; `H`
resets it to the bind pose. `window.__softBody` exposes `particles()`,
`constraints()`, `resets()` and `finite()` for console inspection.

## Gating

| Condition                    | Behaviour                                         |
| ---------------------------- | ------------------------------------------------- |
| No flag                      | Module is never imported — zero bundle, zero cost |
| `?softBody=1`, `low` tier    | **Refused.** WebGL and CI/headless clamp to `low` |
| `?softBody=1`, medium / high | Runs                                              |
| `?softBody=force`            | Runs on any tier — local A/B only                 |

The smoke test therefore never simulates cloth, even if the flag leaks into a
run configuration.

## Budget

| Knob                 | Value                            |
| -------------------- | -------------------------------- |
| Grid                 | 14 × 10 = **140 particles**      |
| Constraints          | ~700 (structural + shear + bend) |
| Substep              | 1/120 s, max 4 per frame         |
| Frame delta clamp    | 0.1 s                            |
| Relaxation passes    | 6 per substep                    |
| Speed clamp          | 24 u/s                           |
| Allocation per frame | none (flat typed arrays)         |

Measured cost: **~0.6 ms/frame** for a 12 × 9 sheet under continuous player
contact (Node + tsx, single-threaded; the browser JIT does better). That is
~4% of a 60 fps frame for a single decorative object — which is exactly why it
is flag-gated and capped at one instance. Scaling this to many props means
moving the solve to a compute shader first; the JS solver is the prototype, not
the plan.

The whole cost is the constraint loop: substeps × iterations × links
(4 × 6 × 700 ≈ 17k projections/frame). Lowering `iterations` is the first knob
if the sheet needs to get cheaper; lowering it too far makes the cloth rubbery.

## Why it stays candy

- **Overdamped.** Velocity retention is 0.86/s, so motion reads as slow jelly
  wobble rather than a snapping flag.
- **Stretch is hard-clamped** at 1.12× rest per link, above and beyond the
  stiffness solve. The sheet physically cannot draw out into thin strings, no
  matter how hard it is shoved — no uncanny taffy stretch.
- **Contacts only repel.** Terrain height field and the player capsule push
  particles out; nothing pins, grabs or tears. The player capsule is one-way,
  exactly like the rigid-body layer's — cloth can never affect movement.
- **Wind is a slow sine**, per-row phase-shifted into a travelling ripple,
  rather than turbulence noise.

## Stability

Every step ends with a finite check. A non-finite particle resets the whole
sheet to its bind pose and increments `resetCount`; the demo logs a
`console.error` when that happens, so a divergence is impossible to miss.
`tests/soft-body.test.mjs` asserts `resetCount === 0` after 10 s of continuous
player bumps through the sheet.

## Non-goals

Production cloth for foliage, tearing, self-collision, cloth-vs-rigid-body
contacts, and replacing the TSL wind deform. If this graduates, it graduates as
a compute shader.

## Tests

```bash
npm run test:softbody   # tests/soft-body.test.mjs — also part of test:integration
```
