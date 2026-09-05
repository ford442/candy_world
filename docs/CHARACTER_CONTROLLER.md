# Character Controller (#1577)

Kinematic capsule movement for first-person DEFAULT state. All locomotion is owned by `stepCharacter()` in [`src/systems/physics/physics-updates.ts`](../src/systems/physics/physics-updates.ts).

## Coordinate convention

- `player.position` is the **eye/camera** position (Y).
- Feet height: `player.position.y - CONFIG.player.eyeHeight`
- Ground support height comes from `getUnifiedGroundHeightTyped(x, z)` via a capsule footprint probe.

## Pipeline

```
handleAbilities()          → velocity impulses (dash, double-jump)
calculateMovementInput()   → CharacterIntent
stepCharacter(dt, intent)  → position, velocity, isGrounded
BPM wind                   → position.xz nudge
resolveGameCollisionsWASM  → clouds, trampolines, mushrooms
reconcileGroundedEyeY      → near-terrain smoothing (skips elevated platforms)
foliage interaction checks → pads, geysers, traps, etc.
```

## Entry points

| Symbol | File | Role |
|--------|------|------|
| `stepCharacter` | `physics-updates.ts` | Single kinematic integration step |
| `probeCapsuleGround` | `physics-updates.ts` | Capsule footprint ground sample |
| `CHARACTER_CONTROLLER` | `physics-types.ts` | Tunable config block |
| `resetCharacterControllerState` | `physics-types.ts` | Clear coyote/buffer timers on spawn |

## Features

### Capsule ground probe

Samples center + cardinal ring points at `capsuleRadius`. Uses **max** height as support (prevents sinking into local bumps). Normal from `sampleGroundNormal` at probe center.

### Slope handling

- Slope angle from ground normal: `acos(normal.y)`
- **≤ maxSlopeDeg**: project wish direction onto ground tangent; walk
- **> maxSlopeDeg**: block uphill input; apply `slopeSlideAccel` along downhill tangent

### Step-up

When grounded and moving, probes forward at `stepProbeDistance`. If ledge ΔY is in `(skinWidth, maxStepHeight]`, raises eye Y before horizontal integration.

### Coyote time + jump buffer

- **Coyote**: after leaving ground, jump remains valid for `coyoteMs`
- **Buffer**: jump press within `jumpBufferMs` before landing fires on touchdown
- Ground jump velocity: `jumpVelocity` (air double-jump stays in `physics-abilities.ts`)

### Air control

- Ground: lerp horizontal velocity toward wish × speed at `moveAccel`
- Air: additive steering at `moveAccel × airControl` (preserves dash impulse)
- Terminal fall clamp: `terminalFallSpeed`

## Tuning table

All values live in `CHARACTER_CONTROLLER` ([`physics-types.ts`](../src/systems/physics/physics-types.ts)).

| Field | Default | Description |
|-------|---------|-------------|
| `capsuleRadius` | `0.35` | Horizontal footprint probe radius (world units) |
| `skinWidth` | `0.08` | Grounding snap epsilon |
| `maxSlopeDeg` | `42` | Walk threshold; steeper slopes slide |
| `maxStepHeight` | `0.4` | Max auto step-up without jumping |
| `coyoteMs` | `120` | Grace period after leaving ground for jump |
| `jumpBufferMs` | `120` | Jump input queued before landing |
| `airControl` | `0.35` | Horizontal input authority while airborne (0–1) |
| `terminalFallSpeed` | `55` | Max downward velocity (units/s) |
| `moveAccel` | `15` | Ground horizontal acceleration |
| `jumpVelocity` | `8.0` | Ground jump initial vy |
| `slopeSlideAccel` | `12` | Downhill slide acceleration on steep slopes |
| `stepProbeDistance` | `0.45` | Forward ledge probe distance |
| `footprintSamples` | `4` | Cardinal ring samples (1–4) |

### Related CONFIG values (not in CHARACTER_CONTROLLER)

| Field | Location | Default | Interaction |
|-------|----------|---------|-------------|
| `eyeHeight` | `CONFIG.player` | `1.8` | Eye ↔ feet offset |
| `platformElevationThreshold` | `CONFIG.ground` | `1.25` | `reconcileGroundedEyeY` skips smoothing when above terrain by this amount |
| `followLerpSpeed` | `CONFIG.ground` | `12` | Camera Y lerp in `updatePhysics` (visual only) |

## Ability integration

`handleAbilities` runs **before** `stepCharacter` and is not modified by this feature:

| Ability | Effect | Controller interaction |
|---------|--------|------------------------|
| Dash / dodge roll | Adds to `velocity.xz` | Preserved; air control only steers input wish |
| Double jump | Sets `vy = 11.5` when airborne | Separate from ground jump / coyote |
| Ground jump | — | Owned by `stepCharacter` (coyote + buffer) |

## WASM collision

`resolveGameCollisionsWASM` runs **after** `stepCharacter` for walkable clouds, trampoline mushrooms, and dynamic foliage. Platform elevation is preserved by `reconcileGroundedEyeY` internal threshold check.

## Zero-allocation hot path

Module-scope scratch reused every frame (no `new` in `stepCharacter`):

- `_scratchGroundNormal`, `_scratchSlideDir`, `_scratchWishOnPlane`, `_scratchDownhill`, `_scratchInputVel`
- `_scratchCapsuleProbe`, `_stepResult`, `_ringOffsets`
- `_characterIntent` in `physics-core.ts`

## Testing

```bash
npm run build          # full WASM + Vite
npm run test:wasm      # if assembly touched
npm run test           # Playwright boot smoke
```
