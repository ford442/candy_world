# Input slice 2: gamepad device on the action layer, hot-plug prompts, beat haptics (#2027 slice 2)

Expanded 2026-11-04 from three model reviews (Gemini, gpt-oss-120b, Grok), every claim re-checked against `main` @ `b350058`. One of the three reviews was run against a tree **without** slice 1 and proposed polling the pad into `keyStates` and deriving contexts by hand; that is not the tree on `main`, and the parts of that review that assumed it are dropped. What survived from it is listed under "Findings".

## Context / motivation

#2061 landed #2027 slice 1 and it is on `main`: `src/core/input/actions/` (`action-layer.ts`, `bindings.ts`, `frame.ts`, `keyboard-mouse.ts`, `settings-store.ts`, `types.ts`, `index.ts`), `docs/INPUT.md`, `tests/input-actions.test.ts`, the rebinding UI in `src/ui/input-controls-section.ts`, and a `no-restricted-syntax` rule (`warn`) against global key listeners outside `core/input/`. Devices write **sources** (`layer.press('key:KeyW', mods, 'kbm')`, `layer.addAnalog('mouse:move', dx, dy, 'kbm')`), the layer samples them once per frame in the `input-actions` system (first in the scheduler's `input` phase), game code reads `input.get(action)` / `input.onPress(action, fn)`, and `frame.ts` is the only writer of `keyStates` for the fixed step. Build mode pushes the `build` and `gizmo` contexts and binds every build action through `input.onPress`; photo mode pushes `photo`; `fire` / `interact` / `grenade` are actions wired in `src/core/main/input-pipeline.ts:146-166`.

What is missing is the device: `navigator.getGamepads` has zero callers in `src/`, `Device` already includes `'gamepad'`, `lookSensitivity` is already `Record<Device, number>`, `isRebindableSource` only accepts `key:` and `mouse:`, and `input.lastDevice()` has no consumer that changes a prompt. This slice adds the gamepad as a second device on the same seams, plus beat haptics. It is the epic's slice 2 of 5 (3 touch, 4 XR spike, 5 XR locomotion). Active focus areas served: music reactivity (rumble on beats and kicks) and the player-controls foundation that build mode on any device (#1974) and phone joins to shared worlds (#1975) need.

## Findings that shape the design (verified on `main`)

1. **Poll inside `frame.ts`, not as a new scheduler system.** `updateInputActions()` already does menu-context → `input.sample()` → `keyStates` → look. A pad poll goes in that function right before `input.sample()`. Registering a separate `gamepad` system would change the frame order and `tests/scheduler-order.test.ts` snapshots the declared order; keep it out of `game-loop-systems.ts`.
2. **Look is gated on pointer lock.** `frame.ts:113` returns unless `target.isLocked`. Stick look must pass when the look sample came from the gamepad, with pointer lock or without. Mouse look stays locked-only (`keyboard-mouse.ts:69-71`).
3. **Pointer lock needs a transient activation, and a gamepad button is not one.** The start overlay's `#startButton` click calls `controls.lock()` (`pointer-lock.ts:21-24`). A pad-only player can still dismiss the overlay and play unlocked: movement runs on the camera basis without lock, and stick look does not need it. Start on the pad clicks `#startButton` only when `navigator.userActivation.isActive` is true; otherwise it hides `#instructions` through the same path the `lock` listener uses and plays unlocked. "Pad present, no pointer lock" is a valid state. (Chrome, Safari and Firefox also hide pads from `getGamepads()` until a button press or stick movement while focused, so the first press is also the "activation" of the pad itself.)
4. **Beat haptics have three different sources, none inside music-reactivity.** `BeatSync.update()` (`src/audio/beat-sync.ts:28-44`) fires every subscriber when `beatPhase` wraps from above 0.8, once per beat of the BPM clock, not per kick; `beatSyncRef` is exported from `src/core/game-loop-core.ts:182` and assigned in `initGameLoopDependencies`. The per-track kick is `visualState.kickTrigger` (tracker playback sets it to 1 on any note trigger at `audio-system-playback.ts:711`, the generative engine on channel 0 steps at `generative-engine.ts:238`, both decay at rate 8). Chord strike is a gameplay edge on `keyStates.strike` in `game-loop-gameplay.ts:70-90`, and geyser burst is `fireScoreEvent('geyserBurst')` in `living-score.ts:159`. Three strengths, three latches, no edit to `music-reactivity*.ts`.
5. **Two settings stores exist.** The action layer persists `candy-input-v1` (`settings-store.ts`) with `lookSensitivity` per device and a global `invertY`. `src/systems/accessibility.ts` still carries `gamepadEnabled`, `gamepadSensitivity`, `gamepadVibration` (default `true`) and `Keybinding.gamepadButton` from before slice 1, persisted under `candy_world_accessibility` and read by nothing. This slice uses the action layer's store only, adds `haptics: boolean` (default `false`) and `invertY` per device there, and marks the accessibility.ts fields `@deprecated` with a one-line pointer (do not delete; the menu's motor section still renders them).
6. **Prompts are static.** `src/ui/ability-hud.ts:170-186` mounts the three ability slots with literal keys `E`, `F`, `Z` (`aria-keyshortcuts` + a `.ck-kbd` badge) and `index.html` has a static `<kbd>` controls guide. Nothing reads `lastDevice()`. A small `onChange`-style device listener on the layer is enough to rewrite the three `.ck-kbd` texts; `index.html` stays the keyboard guide.
7. **Budget.** `tools/build-optimizer/budgets.json` caps `app` at 850 KB with a CI cap note of 765 KB; `src/core/input/**` is statically imported from `input-pipeline.ts`, so a new module lands in `app`. A deadzone, a curve, a button table and a poll are a few KB. The `gamepadconnected` listener must stay static; the poll body may be split behind a dynamic import on first connect only if `budget:check` moves.
8. **Platform facts (Grok, late 2026).** `vibrationActuator.playEffect('dual-rumble')` works in Chrome/Edge and Safari 16.4+, not Firefox; `'trigger-rumble'` is Chrome/Edge 126+; `pulse()` and `.type` are deprecated, check the `effects` array. `XRInputSource.gamepad` uses `mapping: 'xr-standard'` with a different button order and is not in `getGamepads()`, so slice 4/5 needs its own table, not this one.

## Proposed approach

### 1. `src/core/input/actions/gamepad.ts` (new)

Pure, exported, testable pieces plus one install function:

- `applyRadialDeadzone(x, y, inner = 0.18, outer = 0.98): [x, y]` (radial, remapped so the vector keeps its direction and starts at 0 just outside the ring).
- `applyLookCurve(v, exponent = 1.6)` (monotonic, sign-preserving; movement stays linear).
- `triggerPressed(value, wasPressed)` with hysteresis (press above 0.6, release below 0.4) so a resting trigger never flickers an action.
- `STANDARD_BUTTONS` / `STANDARD_AXES` enums for the W3C Standard mapping; a `pad:button:<n>` / `pad:ls` / `pad:rs` / `pad:lt` / `pad:rt` source vocabulary.
- `sampleGamepad(pad, prev, dtSeconds, settings)` → the list of `press` / `release` / `addAnalog` calls for one pad. Sticks publish through `addAnalog`: `pad:ls` → `move` (unit-scaled, the layer normalizes), `pad:rs` → `look` in **radians for this frame** (`curve(axis) * radPerSecond * dt`, with `radPerSecond` = 2.4 × `lookSensitivity.gamepad`). Triggers publish analog `value` on `pad:lt` / `pad:rt` and a digital press via hysteresis.
- `pollGamepads(layer, dtSeconds)`: `navigator.getGamepads()` once per call, first `connected` pad only (multi-pad deferred), skip when `document.hidden`, calls the above. Returns nothing; sets the device to `'gamepad'` through `press` / `addAnalog` as kbm does.
- `attachGamepad(layer, win = window)`: `gamepadconnected` / `gamepaddisconnected` listeners, hot-plug state, `releaseAll()`-equivalent for pad sources on disconnect (release every `pad:*` source so nothing stays latched), announce through `src/systems/accessibility.ts` `announce()`. Returns a detach function, installed from `init-input.ts:80` next to `attachKeyboardMouse`.

### 2. Default bindings (`bindings.ts`)

Add gamepad rows to the existing per-context tables; keyboard rows are untouched.

| Context | Source | Action |
|---|---|---|
| gameplay | `pad:ls` | `move` |
| gameplay | `pad:rs` | `look` |
| gameplay | `pad:button:0` (A / Cross) | `jump` |
| gameplay | `pad:button:1` (B / Circle) | `dash` |
| gameplay | `pad:button:2` (X / Square) | `interact` |
| gameplay | `pad:rt` | `fire` |
| gameplay | `pad:lt` | `sprint` |
| gameplay | `pad:button:10` (L3) | `sneak` |
| gameplay | d-pad 12 / 15 / 13 / 14 | `dash` / `mine` / `phase` / `strike` (the three HUD slots + strike) |
| gameplay | `pad:button:3` (Y / Triangle) | `build.toggle` |
| gameplay | `pad:button:8` (Back / Select) | `photo.toggle` |
| gameplay | `pad:button:9` (Start) | not an action: the start-overlay dismiss from Finding 3, then the same pause path Escape takes (`menu-helpers.ts`), handled in the device |
| build | `pad:rt` / `pad:lt` | `build.place` / `build.remove` |
| build | `pad:button:5` / `pad:button:4` (RB / LB) | `build.rotate` ±1 (repeat) |
| build | `pad:ls` | `build.nudge` axis; `pad:rs` stays `look` |
| build | `pad:button:0` / `pad:button:1` | `build.grab` / `build.cancel` |
| build | `pad:button:2` / `pad:button:3` | `build.gizmo` / `build.snap` |
| build | d-pad up/down, left/right | `build.category` / `build.piece` (repeat) |
| build | `pad:button:8` + LB / RB | `undo` / `redo` |
| photo | `pad:button:0` / `pad:button:1` | `photo.capture` / `photo.exit` (two new `ActionId`s; photo mode today handles Enter/Escape in its own `handleKeyDown`, `photo-mode.ts:239`, and its `photo` context has no bindings). Stick orbit in photo mode is deferred: look there is OrbitControls drag. |
| menu | nothing routes (existing `menu` context blocks below) |

Dodge, clap, dance, grenade, the jukebox/volume toggles, the debug toggles, the four `build.tool.N` and the gizmo actions have no pad default in this slice. There is no `menu` action in `ACTION_IDS`; Start is device-level behaviour, see the row above. `isRebindableSource` accepts `pad:button:*` (not sticks). `formatSource` renders `pad:button:0` as `A` with a Standard-mapping name table; a PlayStation glyph set is deferred (feature-detect from `pad.id` later).

### 3. Hot-plug and prompts

- On connect: `announce('Controller connected', 'polite')`, device becomes `'gamepad'` on the first press, not on connect (browsers only surface a pad after a press anyway).
- On disconnect: release all `pad:*` sources, `announce(...)`, device falls back to `'kbm'` on the next key or mouse event (the layer already sets `device` per press).
- Prompts: a `layer.onDeviceChange(fn)` listener (or reuse `onChange` if device changes are folded into it) rewrites the `.ck-kbd` text under `#ability-dash` / `#ability-mine` / `#ability-phase` from `formatSource` of the current binding for the current device. Keyboard shows `E` / `F` / `Z`; gamepad shows `D-Up` / `D-Right` / `D-Down`.

### 4. Haptics (off by default)

- `InputSettings.haptics: boolean` (default `false`), persisted with the layer's store; a checkbox in `src/ui/input-controls-section.ts` beside the look settings (not the accessibility motor section).
- `playRumble(strength)` in `gamepad.ts`: feature-detects `vibrationActuator` and `effects.includes('dual-rumble')`, wraps `playEffect` in try/catch, re-looks-up the pad by index at call time, never throws, no-ops on Firefox.
- Light rumble: subscribe once to `beatSyncRef.onBeat` from the first `pollGamepads` call that sees `beatSyncRef` non-null (`game-loop-core.ts` does not import input, so no cycle). One effect per wrap: latch on the beat count, so two `update()` calls in one wrap queue one effect. Minimum interval 120 ms.
- Medium rumble: in `pollGamepads`, rising edge of `ctx.audio.kickTrigger` through 0.5 (the audio frame is available from `frame.ts`'s bindings; if not, pass `visualState` into `updateInputActions`). One per rising edge, not per frame while high.
- Strong rumble: the `strike` action's `justPressed` in the same poll (the chord strike is an input edge already), and `geyserBurst`. The geyser pulse needs one call beside `kickDrumGeyserBatcher.triggerErupt()` in `src/systems/living-score.ts:161`; that is the single allowed edit outside the input lane. Drop it and note "geyser rumble deferred" if the lane must stay strict.

### 5. Rebinding UI

`src/ui/input-controls-section.ts` already lists bindings and captures the next key through `input.captureNext`. Extend `captureNext` so the gamepad device can satisfy it: `pollGamepads` passes `pad:button:n` presses through `layer.press`, and `press()` already routes rebindable sources into the capture (`action-layer.ts:246-263`). The only UI change is the row label (`formatSource`) and a hint "Press a key or controller button…". Gamepad bindings persist through the same `overrides` map as keys.

### 6. Docs

`docs/INPUT.md`: a "Gamepad" section with the table above, deadzone/curve/hysteresis constants, the unlocked-play rule, the haptics toggle and its three sources, how to add a `pad:*` binding, and the Firefox/XR caveats from Finding 8.

## Acceptance criteria

- With an Xbox or PlayStation pad in Chrome, after one button press on the start overlay: walk, look, jump, dash, sprint, sneak, the three HUD abilities and strike, build mode (toggle, place, remove, rotate, nudge, grab, cancel, gizmo, undo/redo) and photo mode (toggle, capture, exit; orbit stays mouse) all work with no keyboard and with the pointer unlocked. Stick look works without pointer lock; mouse look still requires it.
- Unplugging mid-deflection leaves no held action (`pad:*` sources released) and the next key press flips prompts back to keyboard glyphs; re-plugging and pressing a button flips them to pad glyphs.
- `tests/input-gamepad.test.ts` (tsx, `check(name, cond)` harness as in `tests/input-actions.test.ts`, no WASM hook; a fake `navigator.getGamepads` returning a four-slot array of `{ buttons: {pressed, value}[16], axes: number[4], connected, index, id, vibrationActuator? }`), wired as `test:input-gamepad` and appended at the **end** of `test:fast`. It covers:
  - radial deadzone: inside the ring publishes 0/0; just outside keeps direction and starts near 0; the look curve is monotonic and above linear at full deflection;
  - trigger hysteresis: 0.5 after a 0.7 press stays pressed, 0.3 releases, 0.45 from rest does not press;
  - gameplay routing: A → `jump`, B → `dash`, X → `interact`, RT → `fire` with analog `value`, LT → `sprint`, d-pad → `dash` / `mine` / `phase` / `strike`, left stick → `move` with length ≤ 1, right stick → `look` scaled by `lookSensitivity.gamepad` and `dt`;
  - contexts: in `build`, RT/LT → `build.place` / `build.remove` and `fire` / `dash` do not fire; RB → `build.rotate` with `repeated`; in `menu` no gameplay action fires; popping restores the previous context;
  - hot-plug: `gamepaddisconnected` releases every `pad:*` source and a following key press makes `lastDevice()` `'kbm'`; a later pad press makes it `'gamepad'`;
  - rebind: `captureNext` resolves with `pad:button:4`, `rebind` persists it through `savePersistedInput` under a fake `localStorage`, and a fresh `ActionLayer(loadPersistedInput())` routes LB to the rebound action;
  - haptics: default off → `playEffect` never called; on → one dual-rumble per `BeatSync` wrap (a second `update()` in the same wrap queues nothing); `kickTrigger` rising through 0.5 queues one medium effect, not one per frame while high; a pad without `vibrationActuator` does not throw; a `playEffect` that rejects is swallowed.
- `npm run typecheck` 0; `npm run lint` at or below `scripts/eslint-baseline.json` with 0 errors (type the Gamepad API with narrow local types, no `any`, no `eslint-disable`); `npm run test:cycles` 0/0 (do not import `game-loop.ts` or `game-loop-systems.ts` from the device); `npm run test:scheduler-order` unchanged; `budget:check` green with the `app` number recorded in the PR.
- Files touched: `src/core/input/actions/{gamepad.ts,bindings.ts,frame.ts,types.ts,action-layer.ts,settings-store.ts,index.ts}`, `src/core/input/input/init-input.ts` (one install call), `src/ui/input-controls-section.ts`, `src/ui/ability-hud.ts` (an exported `setAbilityPrompt(id, text)` only), `src/systems/accessibility.ts` (`@deprecated` comments only), `src/systems/living-score.ts` (one line, optional), `src/systems/photo-mode/photo-mode.ts` (two `input.onPress` lines for `photo.capture` / `photo.exit` beside the existing `pushContext('photo')` at `:145`), `tests/input-gamepad.test.ts`, `package.json`, `docs/INPUT.md`. Nothing under `src/core/entities/**` or `src/world/**` (another session owns those today), nothing in `music-reactivity*.ts`, `game-loop-systems.ts`, `input-pipeline.ts`.

## Decisions on the open questions

- **Raw-key ESLint rule:** stays `warn` and is not ratcheted here; a separate ticket counts the 21 remaining files into a ratchet. This slice adds no raw listener.
- **Haptics source of truth:** split as in Finding 4. `BeatSync` for the light pulse (every beat, no music-reactivity edit), `kickTrigger` for the per-track kick, input/score edges for strike and geyser.
- **Build-mode radial palette:** deferred to slice 3 (touch) so both devices share it; this slice maps the existing `build.*` actions to buttons and d-pad.
- **Sensitivity and invert-Y:** gamepad look has its own radians-per-second scalar behind `lookSensitivity.gamepad` (default 1 = 2.4 rad/s at full deflection), so mouse and stick are independent. Invert-Y becomes per device (`invertY: Record<Device, boolean>`, migrated from the old boolean with kbm keeping the stored value) — a stick and a mouse are inverted by different people.

## Deferred (next slices or their own tickets)

Multiple pads, per-pad calibration, PlayStation / Switch glyph sets from `pad.id`, `trigger-rumble`, the shoulder-button radial palette (slice 3), an `xr-standard` mapping table (slices 4–5), the raw-key ratchet, deleting the pre-slice-1 gamepad fields from `accessibility.ts`.
