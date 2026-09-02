# Character Controller (#1577)

Candy World runs a hybrid WASM dual-architecture physics stack. This
document describes the kinematic character controller that formalizes
first-person locomotion — as actually shipped in
`src/systems/physics/character-controller.ts`, not as a spec to build
toward. If this file and the code ever disagree, the code is right; file a
follow-up to fix the doc.

## Two ground-truth history notes

Two earlier PRs (#1686, #1676) claimed to close this issue and did not:
PR #1686 was a zero-diff commit carrying a full feature commit message, and
PR #1676 shipped only this doc (in a now-superseded, aspirational form) plus
a test that defined its own inline fake and imported nothing from `src/`.
Neither touched `src/`. PR #1691 retracted both claims. This revision is
the first one backed by code that actually exists and a test that actually
imports it.

## Architecture split: which tier owns what

There are two movement paths, selected in `physics-core.ts`'s
`updateDefaultState`:

- **C++ path (off-lake):** `updatePhysicsCPP` (`emscripten/physics.cpp`),
  called across the WASM boundary whenever the player is outside the Melody
  Lake basin.
- **JS-fallback path (in-lake, or on C++ failure):** `updateJSFallbackMovement`
  (`src/systems/physics/physics-updates.ts`), used explicitly inside the
  Melody Lake basin (the C++ engine doesn't know about the visual lake
  carving and would return the wrong ground height there) and whenever
  `updatePhysicsCPP` returns a failure sentinel.

**The character controller described below owns the JS-fallback path only.**
It does not touch, and is not reachable from, the C++ path.

### Why not both paths

Before writing any code for this issue, `emscripten/physics.cpp` was read in
full to check whether the native path already had any of this (it would
have changed the whole approach). It does not:

- `updatePhysicsCPP` ground-checks with a single-point
  `getGroundHeight(nextX, nextZ)` call — no footprint sampling, no surface
  normal, no slope concept at all.
- The eye-height snap is a hardcoded `nextY < groundY + 1.8f` — no
  configurable step height, no ledge-block resolve.
- Horizontal smoothing is one flat `15.0f * delta` regardless of airborne
  state — no ground/air acceleration split.
- Jump only fires when `onGround == 1` in the exact frame the input arrives
  — no coyote time, no jump buffering, no skin-width hysteresis.

So architecturally the "right" long-term shape is a controller that owns
ground-contact resolution for *both* paths, with C++ reduced to raw
integration. That is not what shipped here: extending `emscripten/physics.cpp`
would require rebuilding the WASM binary (`npm run build:emcc`) and touching
`verification/verify_emcc_exports.js`, none of which were in scope for the
file set this change was allowed to touch. Instead, the C++ path is left
**byte-identical** — same single-point snap, same flat acceleration, same
immediate-only jump. Off-lake, the seven behaviours below simply don't apply
yet. Extending `updatePhysicsCPP` to match is real follow-up work, tracked
separately (see `.swarm-state.md` for the exact reasoning).

## The controller

`src/systems/physics/character-controller.ts` exports one pure function:

```ts
resolveCharacterMovement(
    delta: number,
    player: PlayerExtended,
    targetVelocityXZ: { x: number; z: number },
    jumpHeld: boolean,
    jumpTriggered: boolean,
    groundQuery: CharacterGroundQuery
): CharacterMovementOutcome
```

It is called from `updateJSFallbackMovement`, which computes the
camera-relative `targetVelocityXZ` from `keyStates` (unchanged from before
this issue) and passes the real ground-sampling functions as `groundQuery`:

```ts
resolveCharacterMovement(delta, player, _targetVelocity, keyStates.jump, jumpTriggered, {
    sampleFootprint: sampleGroundFootprint, // ground-system.ts
    getGroundHeight,                        // ground-system.ts
});
```

`groundQuery` is an **injected parameter, not a static import** of
`ground-system.ts`. That module transitively imports the WASM bridge
(`utils/wasm-loader.ts`), which does a Vite-only
`import initCandyPhysics from '../wasm/candy_physics.wasm?init'` — this
cannot be loaded under a plain Node/tsx test runner (confirmed directly:
`ground-system.ts` fails to import under `tsx` both before and after the
WASM file is built, first with a missing-module error, then with
`Cannot find package 'env'`). Injecting the dependency means
`character-controller.ts` itself only imports `three`, `CONFIG`, and the
`PlayerExtended` type — so `tests/character-controller.test.mjs` can import
the real, production `resolveCharacterMovement` and drive it with mock
ground queries, the same way `physics-updates.ts` drives it with real ones.

### Behaviours implemented

1. **Footprint-sampled ground contact.** Ground contact is checked via
   `sampleGroundFootprint(x, z, CONFIG.player.radius, CONFIG.ground.footprintSamples)`
   at the destination XZ, not a single center-point `getGroundHeight` call.
   `footprint.minY` is the ground height used for the contact/step decision;
   `footprint.normal` (computed internally by `ground-system.ts` via
   `sampleGroundNormal` at the footprint centroid) drives the slope check.
2. **Slope limit + downhill slide.** If the footprint normal's angle from
   world-up exceeds `CONFIG.player.slopeLimit`, the player is *not* grounded
   — instead, a horizontal downhill impulse (`gravity * sin(angle)` along the
   slope's downhill tangent) is added to velocity and the player keeps
   falling. `CONFIG.player.slopeLimit` is a **new, player-owned constant** —
   it deliberately does **not** reuse `CONFIG.ground.maxSlopeAngle`, which is
   the #1302 prop-placement limit (see its doc comment in
   `src/core/config/types.ts`); coupling player locomotion to tree/prop
   placement tuning would be a bug, not a simplification.
3. **Step-up / ledge-block.** If the destination footprint's ground rise
   from the player's current feet height is within `CONFIG.player.stepHeight`,
   the player snaps up onto it (bounded, not a teleport). If the rise
   exceeds `stepHeight`, forward XZ motion into it is rejected — the player
   stays at its current XZ and a second footprint sample there decides
   whether it's still standing (this is a movement resolve: reject-and-fall
   or reject-and-stand, not a teleport that could punch through geometry).
4. **Coyote time.** `player.controllerClock` is an accumulated sum of
   physics deltas (**not** `Date.now()`/`performance.now()`), so it stays
   correct under frame stalls and the game's own time-scaling (groove
   gravity, etc.). `player.lastGroundedTime` records the clock value at the
   last grounded frame; a jump still fires up to `CONFIG.player.coyoteTimeMs`
   after leaving the ground.
5. **Jump buffering.** `player.jumpPressedTime` records the clock value at
   the last rising-edge jump press; a jump fires on ground contact if that
   press was within `CONFIG.player.jumpBufferMs`, even if the key is no
   longer held by the time the player lands. The buffer is consumed
   (`jumpPressedTime` reset to `-Infinity`) once used, so it can't re-fire on
   a later landing.
6. **Separate ground vs. air acceleration.** Horizontal velocity smooths
   toward the target at `CONFIG.player.groundAccel` while grounded (using
   the *previous* frame's grounded state) or `CONFIG.player.airAccel` while
   airborne — replacing the old flat `15.0 * delta` smoothing that made no
   distinction, which was the single biggest correctness gap this issue
   existed to close.
7. **skinWidth hysteresis.** `CONFIG.player.skinWidth` is added as a margin
   to every ground-snap check, so a grounded player's next-frame integrated
   Y (a few millimeters below the snap height from one frame of gravity)
   still reads as "touching ground" instead of flickering `isGrounded`
   false/true every frame.

### CONFIG.player (src/core/config/types.ts, defaults in src/core/config/ground.ts)

| Field | Default | Meaning |
|---|---|---|
| `radius` | `0.4` | Footprint sampling radius (world units) for ground-contact queries. |
| `groundAccel` | `15.0` | Horizontal velocity smoothing rate (1/s) while grounded. |
| `airAccel` | `5.0` | Horizontal velocity smoothing rate (1/s) while airborne. |
| `jumpVelocity` | `8.0` | Vertical speed applied when a jump fires. |
| `stepHeight` | `0.35` | Max ledge height auto-stepped without jumping. |
| `skinWidth` | `0.05` | Ground-snap margin to prevent isGrounded chatter. |
| `coyoteTimeMs` | `100` | Grace window after leaving ground during which jump still fires. |
| `jumpBufferMs` | `100` | Window a jump press is buffered before landing. |
| `slopeLimit` | `45°` (radians) | Player-owned walkable slope limit — not `CONFIG.ground.maxSlopeAngle`. |

## Preserved, unchanged behaviour

- **Spawn protection (#1684):** `player.spawnProtectFrames` still freezes
  gravity for a few frames after spawn/teleport, with the same last-frame
  re-snap via single-point `getGroundHeight` (not footprint — this is a
  narrow spawn-safety probe, not part of the locomotion loop). Now lives
  inside `resolveCharacterMovement` instead of `updateJSFallbackMovement`
  directly, same logic and thresholds.
- **`reconcileGroundedEyeY` (#1265):** still runs in `physics-updates.ts`
  after the controller resolves the frame, smoothing camera Y toward the
  authoritative ground height while grounded. It now checks `isGrounded`
  *after* the controller's own jump resolution, so on a frame where a jump
  fires it correctly no longer also tries to smooth-lerp Y toward the
  ground on the same frame — a minor, accepted behaviour change (the final
  jump velocity and landing FX are unaffected either way).
- **Landing impact/audio/camera shake:** unchanged FX thresholds and calls,
  now driven by `resolveCharacterMovement`'s returned `justLanded`/`fallSpeed`.
  Note: this carries forward a pre-existing quirk — `fallSpeed` is read
  *after* `velocity.y` has already been zeroed on the ground-snap path, so
  it is always `0` and the "soft landing" FX branch always fires regardless
  of actual fall speed. This was true in the code before this issue too;
  fixing it wasn't part of #1577's scope, so it was left as-is rather than
  quietly changed as a drive-by.
- **Ability velocity hooks (`physics-abilities.ts`):** `handleAbilities`
  still runs before movement resolution each frame (unchanged call order in
  `physics-core.ts`); their velocity output is an input to the controller,
  not something the controller redesigns.

## Testing

`tests/character-controller.test.mjs` imports the real
`resolveCharacterMovement` export (no inline fake, no mocked `CONFIG`) and
covers: grounded/air acceleration, a walkable slope vs. one past
`slopeLimit` (slide), a step under `stepHeight` (climbs) vs. over it
(blocked), a jump inside the coyote window vs. after it expires, a buffered
jump firing on landing, a stale buffered press not carrying over, and
`isGrounded` stability across 30 frames on flat ground.

Run: `npm run test:character`. Wired into `npm run test:integration`.
