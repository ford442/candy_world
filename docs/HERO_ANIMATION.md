# Hero Animation (clip-based)

Candy World animates almost everything **procedurally**: plant pose machines,
TSL wind deformation, and the GPU foliage animator. That is the right default —
it scales to tens of thousands of instances with no per-object CPU work.

What it cannot do is play an _authored_ animation: a chest lid that opens on a
specific arc, a creature with a walk cycle a designer keyframed. This document
covers the small, deliberately-capped system that does — and, more importantly,
where the line between the two sits.

## Hero vs batch

This is the split. It is the load-bearing idea in this document.

|                    | **Hero**                                   | **Batch**                                        |
| ------------------ | ------------------------------------------ | ------------------------------------------------ |
| Count              | ~1–8 objects                               | hundreds to tens of thousands                    |
| Driven by          | authored clips (`AnimationMixer`)          | procedural pose machines, TSL, boids             |
| Cost model         | one mixer tick per object per frame        | one uniform/compute update per _batch_           |
| Owns its transform | yes — a real `Object3D` in the scene graph | no — a row in an instance matrix buffer          |
| Code               | `src/systems/animation/`                   | `src/foliage/*-batcher.ts`, `src/systems/fauna/` |
| Examples           | chests, doors, a named story creature      | grass, mushrooms, the fauna boid swarm           |

**The rule: authored motion for a handful of named objects goes on the hero
path. Anything you spawn in a loop stays on the batch path.**

The failure mode this exists to prevent is a mixer per instance. `AnimationMixer`
evaluates keyframe tracks on the **CPU** and writes into an `Object3D`'s TRS —
fine at eight objects, ruinous at eight hundred, and structurally incompatible
with instanced rendering, where the instances have no `Object3D` to write to.

`MAX_HERO_RIGS` (currently 8) in `clip-player.ts` enforces this by warning past
the cap. It is a smell detector, not a hard limit: if you find yourself wanting
to raise it, the content probably wants the batch path instead.

### Where instanced fauna sits

`FaunaSystem` (`src/systems/fauna/fauna-system.ts`) runs the ambient critters
through WASM boids into `FaunaBatcher`, composing an instance matrix per critter
per frame. **It does not use this system and should not.** Skinning that swarm
needs a GPU skin path — bone matrices in a storage buffer, skinned in the vertex
shader, indexed per instance — which v1 does not have. Until it does, instanced
fauna stay on boids + pose.

A _hero_ creature — one named, non-batched creature that a quest cares about —
is exactly what the hero path is for.

## v1: `AnimationMixer` on non-batched meshes

Two options were on the table for v1:

1. Three.js `AnimationMixer` on a few non-batched meshes.
2. A custom clip player writing bone matrices into a uniform/storage buffer,
   so instanced meshes could be skinned.

**v1 is option 1.** The reasoning:

- Option 2 is the _GPU skin path_, and its whole value is instancing — which
  point 4 of this feature's scope explicitly defers. Building the buffer plumbing
  before there is a consumer would be speculative work with no way to validate it.
- The mixer needs no custom evaluation code at all, so the surface area that can
  be wrong is the API wrapper, not the interpolation math.
- Crucially, **it does not block skinning.** `SkinnedMesh` rigs play through the
  identical path: Three's mixer writes bone TRS on the CPU and the skinning
  itself happens on the GPU. A skinned hero needs no API change here. `HeroRig`
  already exposes `isSkinned` as the seam a future GPU path keys off.

So v1 ships keyframed node (TRS) animation with an API that is already the right
shape for skinning, and stops short of instanced skinning until something needs it.

### r171 / WebGPU

Verified on Three r171 with `WebGPURenderer`: node TRS animation is renderer-
agnostic — the mixer writes `Object3D.position/quaternion/scale` and never
touches the render backend. `SkinnedMesh` is supported by the WebGPU backend but
is **unexercised in this codebase**; the first skinned asset should be treated as
a real integration task, not a drop-in.

## The API

Three calls, and one of them belongs to the game loop:

```ts
import { registerHeroRig, playHeroClip, stopHeroClip } from '../systems/animation/index.ts';

// Register once, when the asset lands.
registerHeroRig({ name: 'chest.oak', root, clips, defaultClip: 'closed' });

// Then, from anywhere — no game-loop access required.
playHeroClip('chest.oak', 'open', { loop: false, fade: 0.15 });
stopHeroClip('chest.oak');
```

`updateHeroAnimations(delta)` is called **once** per frame from
`src/core/game-loop.ts`, right after `updateFaunaSystem`. Systems never touch it.

`playHeroClip` returns `false` — rather than throwing — for a rig that is not
registered yet or a clip that does not exist. This is deliberate: a system
reacting to game state should not have to know whether an asset has finished
streaming in, and a missing animation should never take down a frame.

### Loading a glTF

```ts
import { loadHeroRig } from '../systems/animation/index.ts';

const rig = await loadHeroRig({
    name: 'chest.oak',
    url: 'models/chest.gltf',
    defaultClip: 'closed',
});
```

`GLTFLoader` lives behind a dynamic `import()` and is split into its own
`gltf-loader` chunk (see `vite.config.js`), so a boot that loads no rigs never
downloads the loader. `loadHeroRig` rejects on an asset with zero clips — a rig
with nothing to play is always a content bug, and rejecting is easier to debug
than a silent no-op.

### Fauna state → clip

`src/systems/fauna/fauna-clips.ts` maps `FaunaState` onto clip names for hero
fauna:

```ts
syncFaunaHeroClip('fauna.hero', FaunaState.Flee);
```

Safe to call every frame — it only touches the mixer when the state actually
changes. A rig missing the state's clip falls back to `idle`.

| `FaunaState` | Clip   | Crossfade |
| ------------ | ------ | --------- |
| `Wander`     | `walk` | 0.20 s    |
| `Flee`       | `flee` | 0.08 s    |
| `Rest`       | `idle` | 0.35 s    |

Again: this is for hero fauna. `FaunaSystem`'s instanced swarm does not call it.

## Trying it

```
http://localhost:5173/?heroAnim=1
```

A cube on a pedestal near the player spawn plays a looping bounce. `J` cycles
clips (crossfading), `K` stops and restarts. `window.__heroAnim` exposes
`clips()`, `current()`, `skinned()`, `pose()`, `play(name)`, `stop()` and
`next()`.

The demo module and its asset load **only** under the flag, so the default boot
and the smoke test pay nothing for it.

## The test asset

`public/models/hero-clip-test.gltf` — ~3.5 KB, one cube, two clips (`bounce`,
`spin`). It is generated, not exported from a DCC tool, so it stays small and
reviewable:

```bash
node scripts/gen-hero-clip-asset.mjs
```

## Budget

|                      | Cost                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| No rigs registered   | `updateHeroAnimations` early-returns on an empty map — zero                |
| Per rig, per frame   | one `AnimationMixer.update`: a keyframe binding walk over the rig's tracks |
| Bundle, default boot | zero — `GLTFLoader` is a separate chunk, the demo is a debug module        |
| Test asset           | 3.5 KB, fetched only under `?heroAnim=1`                                   |

Actions are created lazily and cached per clip, so a state machine flipping
between two clips allocates nothing after each clip's first play.

## Tests

```bash
npm run test:heroanim
```

Covers playback driving a node's TRS, loop vs one-shot clamping, crossfade
handover, playhead preservation vs `restart`, teardown, the `MAX_HERO_RIGS`
warning, the fauna state binding (including that a steady state never restages
the mixer), and that the shipped glTF parses with both its clips. Part of
`npm run test:integration`.

## Not in scope

Retargeting, IK, blend trees, replacing `PlantPoseMachine`, large character
packs, and GPU skinning for instanced meshes.
