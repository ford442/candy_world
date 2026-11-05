# Input

Game code reads **actions**, not keys. Devices write raw **sources** into the
action layer, and the layer maps them to actions once per frame. Which actions
a press can reach depends on a stack of **contexts**. Issue #2027 tracks the
work. This page covers slice 1 (the layer, keyboard and mouse, contexts and
rebinding) and slice 2 (the gamepad and beat haptics). Touch and WebXR add
devices to the same layer later.

The layer is `src/core/input/actions/`:

| File                 | What it holds                                                             |
| -------------------- | ------------------------------------------------------------------------- |
| `types.ts`           | `ActionId` (every action), `Binding`, `ActionState`, `InputContextId`     |
| `bindings.ts`        | The default bindings per context, labels, `formatSource()` for prompts    |
| `action-layer.ts`    | `ActionLayer`: routing, sampling, listeners, settings, rebinding. No DOM  |
| `keyboard-mouse.ts`  | The browser device: DOM events → sources                                  |
| `gamepad.ts`         | The gamepad device: `getGamepads()` polled per frame → sources            |
| `gamepad-haptics.ts` | Beat rumble (`BeatHaptics`), off by default                               |
| `frame.ts`           | The `input-actions` system: menu context, poll, sample, `keyStates`, look |
| `settings-store.ts`  | `localStorage` persistence of settings and rebinds (`candy-input-v1`)     |
| `index.ts`           | `input`, the app's instance, and `gamepadHaptics`                         |

## Reading actions

```ts
import { input } from '../core/input/actions/index.ts';

// Per frame, from a system: state as of this frame's sample.
const move = input.get('move').axis; // { x: strafe, y: forward }, length ≤ 1
if (input.get('jump').justPressed) {
    /* … */
}

// Events, for UI and one-shot toggles. Both return an unsubscribe function.
const off = input.onPress('build.toggle', () => toggleBuildMode(scene));
input.onPress('build.rotate', (s) => (yaw += s.value * STEP), { repeat: true });
input.onAction('jukebox', (s) => {
    if (s.justReleased) unlightButton();
});

input.lastDevice(); // 'kbm' | 'gamepad' | 'touch' | 'xr', for button prompts
```

`ActionState` has `pressed`, `justPressed`, `justReleased`, `repeated` (the OS
auto-repeated a held key this frame), `value` and `axis`. For a button, `value`
is the matching binding's `scale`, and its sign carries the direction: Shift+R
rotates with `-1`. For an axis action (`move`, `look`, `build.nudge`), `axis`
is the sum of what is held, normalized to length 1 except for `look`.

The `input-actions` system runs first in the scheduler's `input` phase
(`game-loop-systems.ts`), so every later system sees this frame's input.
`onAction` / `onPress` callbacks run inside that sample. Nothing happens
before the game loop starts.

### keyStates

The fixed-step physics still reads `keyStates` (`core/input/input-types.ts`).
`frame.ts` is the only writer. Each frame it maps the actions onto it, so
`keyStates` is the input frame of the fixed step, and the input log that
`tests/fixed-step-determinism.test.ts` replays. Two rules carry over from the
old keydown handlers:

- **Explore** (the dev orbit camera) pauses the player: there are no abilities,
  and movement only pans the hybrid camera.
- **Jump** is written on its edges only, and physics clears it when a jump
  lands. Holding Space therefore jumps once. Before the layer, OS key repeat set
  it again after about half a second.

### Mouse look

`look` comes from pointer-locked mouse motion in radians (0.002 per pixel, as in
PointerLockControls). The look sensitivity and invert-Y settings apply to it.
`initInput()` unhooks PointerLockControls' own `mousemove`, and `frame.ts`
turns the camera from `look`, with the same pitch clamp and `change` event. If
a three upgrade renames `_onMouseMove`, a warning is logged, three keeps doing
the look, and the settings don't apply.

## Contexts

The contexts, bottom to top, in a fixed priority:

| Context    | Pushed by                                                                          | Blocks below |
| ---------- | ---------------------------------------------------------------------------------- | ------------ |
| `gameplay` | always active                                                                      | –            |
| `xr`       | reserved for slice 4                                                               | no           |
| `build`    | `enableBuildMode()` (`systems/authoring/build-mode.ts`)                            | no           |
| `gizmo`    | the open build gizmo                                                               | yes          |
| `photo`    | photo mode (`systems/photo-mode/photo-mode.ts`)                                    | yes          |
| `menu`     | the pause menu or jukebox (polled in `frame.ts`), and the a11y, save and log menus | yes          |

`const pop = input.pushContext('build')` activates a context, and `pop()`
deactivates it (calling it twice is harmless). Pushes are counted, so two
owners of `menu` both have to pop.

**Routing.** A press goes to the top-most active context that has a binding
matching the source and the modifiers held at that moment. Lower contexts
don't see it. A context with `blocksBelow` stops the search. So:

- In `build`, mouse 0 is `build.place`, and `fire` never sees it. W is not
  bound in `build`, so it falls through to `gameplay` and you keep walking.
- In `menu`, nothing reaches the game. On the keyboard, `menu` binds only L
  (discovery log). Menus handle Tab, Enter, Escape and arrows themselves
  through the DOM, so focus traps and screen readers keep working. A pad has
  none of those keys, so `menu` (and `photo`) bind its buttons to `menu.*`
  actions; see [Menus on a pad](#menus-on-a-pad).

**Edges and holds.** A press is routed when it happens and keeps that route
until release. Its first frame is always delivered to that context, even if a
blocking context opens before the frame samples. This is why Escape in build
mode still drops the piece in hand while the pause menu opens. On later
frames, a held source reads as released while a blocking context is above its
route, and as held again once that context pops.

**Modifiers.** A binding with `mods` matches those modifiers exactly (meta
counts as ctrl). A binding without `mods` matches any modifiers. When both
kinds match the same source in one context, only the exact ones count: Shift+R
is `build.rotate -1` and not also `+1`. Shift+W still walks because `move` has
no `mods`.

A tap shorter than a frame still counts: a source that went down since the
last sample is pressed for one frame.

## Adding an action or a binding

1. Add the id to `ACTION_IDS` in `types.ts`, and a label to `ACTION_LABELS` in
   `bindings.ts` if players can rebind it.
2. Bind it in the right context in `bindings.ts`, for example
   `key('my.action', 'KeyK', { mods: {} })`. Sources are `key:<code>` (the
   `KeyboardEvent.code`), `mouse:<button>`, `mouse:move`, `wheel:up` /
   `wheel:down`, `pad:<button>`, `stick:left` / `stick:right` and
   `ui:<name>` for on-screen controls. Give it a pad binding too (see
   [Adding a gamepad binding](#adding-a-gamepad-binding)).
3. Read it with `input.get()` in a system, or subscribe with `input.onPress()`
   and keep the unsubscribe function.
4. Add a case to `tests/input-actions.test.ts` if it interacts with another
   context.

An on-screen button presses its own `ui:` source with
`input.press('ui:name', 0, device)` and `input.release('ui:name')`. The HUD
D-pad and the ability slots do this (`core/input/input/hud-setup.ts`).

**No global key listeners outside `src/core/input/`.** ESLint's
`no-restricted-syntax` warns on `window` / `document`
`addEventListener('keydown' | 'keyup' | 'keypress')` everywhere else except
`utils/focus-trap.ts`. Element-scoped listeners, such as a widget's own
Enter/Space, are DOM focus handling and are fine. The sites that remain are
counted by the lint ratchet (`npm run lint`). Most are dev tools and menu
Escape handlers.

## Gamepad

`gamepad.ts` reads pads with the [Standard Gamepad
mapping](https://w3c.github.io/gamepad/#remapping): Xbox and PlayStation pads
in Chrome and Edge, and most others. A pad without it is announced as
unsupported and ignored rather than guessed at.

`initInput()` attaches the device, and `frame.ts` calls its `poll()` once per
frame, just before the layer samples, through the `poll` hook of
`bindInputFrame()`. Until a pad connects, `poll()` returns without calling
`getGamepads()`: Chrome only lists a pad after one of its buttons is pressed,
and that press also fires `gamepadconnected`. One scan on the first frame
finds a pad pressed before the game loaded.

### Sources

| Source                                     | Pad                                    | Notes                          |
| ------------------------------------------ | -------------------------------------- | ------------------------------ |
| `pad:a` `pad:b` `pad:x` `pad:y`            | A B X Y / Cross Circle Square Triangle |                                |
| `pad:lb` `pad:rb`                          | LB RB / L1 R1                          |                                |
| `pad:lt` `pad:rt`                          | LT RT / L2 R2                          | Analog: `value` is the pull    |
| `pad:back` `pad:start`                     | View Menu / Create Options             | View is the pad's Ctrl (below) |
| `pad:ls` `pad:rs`                          | stick clicks / L3 R3                   |                                |
| `pad:up` `pad:down` `pad:left` `pad:right` | d-pad                                  |                                |
| `stick:left` `stick:right`                 | sticks, after the deadzone             | Analog, not rebindable         |

`PAD_BUTTONS` in `bindings.ts` lists the names in Standard-mapping order.
Several pads at once all drive the same sources.

- **Triggers** press at 0.35 and release below 0.25, so a trigger resting on
  the threshold doesn't chatter. While held, the action's `value` follows the
  pull.
- **Auto-repeat.** A held button repeats after 0.4 s, then every 0.12 s, like
  a key. `onPress(..., { repeat: true })` works on the d-pad and bumpers.
- **View is Ctrl.** A button pressed while View is held carries the `ctrl`
  modifier, so `{ source: 'pad:lb', mods: { ctrl: true } }` is View+LB, shown
  as `View+LB` (`Create+L1` on a PlayStation pad). View alone binds nothing by
  default. Plain bindings on a button that also has a View chord carry
  `mods: {}`, so the chord fires only the chord.

### Sticks, deadzone and look curve

Both sticks use a **radial deadzone** (`radialDeadzone()`): below the deadzone
the stick reads centered, and above it the magnitude is rescaled from 0 to 1,
so there's no jump at the edge and diagonals aren't pulled onto the axes. Up is
`+y` for both sticks.

- `stick:left` → `move`. `frame.ts` still turns `move` into the `keyStates`
  booleans at 0.25, so walking is not yet analog.
- `stick:right` → `look`. The magnitude goes through the **look curve**
  (`applyLookCurve()`, magnitude to the power of `lookCurve`, 2 by default),
  then becomes radians for this frame: 2.6 rad/s at full yaw, 0.75 of that for
  pitch, times the frame time (capped at 0.1 s so a stall doesn't fling the
  camera). The layer then applies `lookSensitivity.gamepad` and invert Y.

Invert Y is one setting for every device. Look sensitivity is per device, and
the gamepad's 1 means the stick rate above, not the mouse's speed.

### Default bindings

| Pad                | Playing                   | Build mode                         | Gizmo       | Menus and photo            |
| ------------------ | ------------------------- | ---------------------------------- | ----------- | -------------------------- |
| Left stick         | move                      | (move)                             |             |                            |
| Right stick        | look                      | (look)                             |             |                            |
| A                  | jump                      | (jump)                             | done        | select                     |
| B                  | dash                      | cancel                             | done        | back (photo: leave)        |
| X                  | interact                  | move piece                         | move        |                            |
| Y                  | build mode                | (leave build mode)                 | rotate      |                            |
| LB / RB            | dodge / chord strike      | rotate − / +                       | – / scale   |                            |
| LT / RT            | grenade / fire            | remove / place                     |             |                            |
| L3 / R3            | sprint / sneak            | (sprint) / gizmo                   |             |                            |
| D-pad ↑ ↓ ← →      | phase, mine, clap, dance  | scale + −, piece − +               |             | focus prev / next          |
| Start              | pause                     | (pause)                            |             | resume (other menus: back) |
| View+A / B / X / Y | log, mute, jukebox, photo | place, remove, select, paint tools |             | (photo: View+Y leaves)     |
| View+↑ ↓ ← →       | day/night, –, volume − +  | grid snap, recenter, category − +  |             |                            |
| View+LB / RB       | (dodge / strike)          | undo / redo                        | undo / redo |                            |
| View+LT / RT       | (grenade / fire)          | next paint / add to selection      |             |                            |

Parentheses mean the context has no binding of its own for that press: it
reaches the plain binding, or the context below. In build mode, RT places, so
`fire` never sees it, the same as mouse 0. In photo mode, Start does nothing.

Not bound on a pad: `build.nudge` (both sticks are taken), `music.upload`
(a file picker needs a click), and the dev overlays.

### Menus on a pad

`core/input/input/gamepad-menu.ts` turns the `menu.*` actions into the DOM
steps the keyboard uses:

- **`pause`** (Start): while playing, releases pointer lock, which opens the
  pause menu the way Escape does. In the pause menu, it asks for pointer lock
  again to resume. In any other menu, it backs out.
- **`menu.next` / `menu.prev`** (d-pad): move focus, wrapping, within the
  focused dialog (or the pause menu).
- **`menu.confirm`** (A): clicks the focused control.
- **`menu.back`** (B): dispatches an Escape `keydown` on the focused element,
  so each menu's own Escape handling runs unchanged.

Entering the game still takes a click or a key: browsers grant pointer lock
and start audio only after one. Chrome may also refuse to lock again from a
pad button. When it does, the pause menu stays open and announces "Click or
press Enter to resume".

### Hot-plug

On `gamepadconnected`, the device sets `lastDevice()` to `'gamepad'` before the
first press, so prompts can switch glyphs. It also announces the pad's name
through the live region (`ui/announcer.ts`). On `gamepaddisconnected`, every
button the pad held is released at once, its sticks stop contributing, and
with no pad left, `lastDevice()` returns to `'kbm'`. A pad that vanishes from
`getGamepads()` without the event is handled the same way on the next poll.

`input.onDeviceChange(fn)` reports a change of `lastDevice()` once, from the
next sample. Use it for button prompts. `formatSource(source, mods, style)`
names a source, and `activeGamepad()?.padStyle()` gives `'xbox'` or
`'playstation'` (from the pad's vendor id) for the style. Today no HUD prompt
reads `lastDevice()` yet; the Controls section uses the style for its pad rows.

### Beat haptics

`gamepadHaptics` (`gamepad-haptics.ts`) rumbles every connected pad lightly
on kick-drum beats.

- **Kicks.** Every frame, `onAudioFrame()` reads the audio's `kickTrigger`.
  Both the tracker and the generative engine set it to 1 on a hit and let it
  decay, so a rise to at least 0.5 is a kick, and that kick rumbles.
- **Beats.** `initInput()` gives it its own `BeatSync` on the app's
  `AudioSystem`. `onBeat` runs once per beat (the beat phase wrapping) and
  opens one rumble slot.
- **Why both.** The beat wrap alone can't be the trigger. Kicks rarely land
  on it, and by the time the phase wraps, `kickTrigger` has usually decayed
  to near 0. Measured in the browser, it was 0.02 at the wrap against a peak
  of 0.88.
- **Cost.** Both run from the gamepad poll, and only while a pad is connected
  and rumble is on, so they cost nothing otherwise.
- **Strong pulses.** `gamepadHaptics.pulse('strong')` is for big moments.
  Nothing calls it yet: chord strike and geyser launches don't raise an event
  that `core/input` can hear, so wiring them is a follow-up in
  `gameplay/chord-strike.ts` and the geyser physics.
- **Limits.** At most one effect per beat, whichever asks first. Two effects
  never start less than 120 ms apart. With no music playing, strong pulses
  are spaced by that gap alone.
- **Safety.** Pads without `vibrationActuator`, or without `playEffect`, are
  skipped. An effect that throws or rejects (a pad unplugged mid-rumble) is
  swallowed.
- **Setting.** Off by default. It is `settings.gamepad.haptics`, persisted
  with the other input settings.

### Adding a gamepad binding

1. Add a `pad('my.action', 'x')` line to the context's `*_PAD` table in
   `bindings.ts`, next to the keyboard one. For a View chord, use
   `pad('my.action', 'x', { mods: view })`. If the button already has a plain
   binding in that context, give the plain one `mods: plain` so the chord
   doesn't fire both.
2. Check the context below doesn't need the button (unbound buttons fall
   through), and that the [default bindings](#default-bindings) table above
   stays true.
3. Add a case to `tests/input-gamepad.test.ts`. Its fake `getGamepads()`
   (`makePad()`, `setButton()`, `frame()`) presses Standard-mapping indices
   through the real device.

## Settings and rebinding

The Accessibility menu's Motor tab has a **Controls** section
(`ui/input-controls-section.ts`). It lists every keyboard/mouse binding and
every gamepad button binding, by device and then context, and offers:

- mouse look speed and stick look speed
- invert Y (all devices)
- hold or toggle for sprint and sneak
- stick deadzone (0–0.5, default 0.15) and look curve (1–3, default 2)
- rumble on the beat (off by default)
- reset

Pressing a binding's button starts `input.captureNext(fn, { device })`:

- The next key (with its modifiers), mouse button or pad button of that row's
  device becomes the binding. The other device keeps working, so a pad can
  still move focus while a keyboard row waits. Escape cancels.
- A lone Shift, Ctrl, Alt or View binds itself when released. View held with
  another button captures the chord.
- In a menu, left click stays a click, so it can't be captured.

Each change is announced through the live region, and so is a clash with
another binding in the same context.

Rebinds are stored as overrides of the default bindings, keyed by
`bindingKey()`, as strings like `Ctrl+Shift+key:KeyZ` or `Ctrl+pad:lb`
(View+LB). Settings and rebinds
persist in `localStorage`. Once #1974 lands they move to `WorldDocument`
settings.

Run `npm run test:input-actions` for contexts, modifiers, edges, look settings,
rebinding and persistence, and the `keyStates` bridge. Run
`npm run test:input-gamepad` for the deadzone and curve math, pad buttons in
each context, triggers, sticks, auto-repeat, hot-plug, gamepad rebinding and
haptics.

## Not yet

- **Build radial palette** on a shoulder button: waits for slice 3, so one
  palette serves pad and touch. Until then the d-pad steps pieces and
  categories.
- **Analog walking.** The stick's magnitude stops at `keyStates`' booleans.
- **Strong haptics** on chord strike and geyser launches (see above).
- **Touch** (slice 3): a virtual joystick, drag-look and tap-to-interact. Today
  only the D-pad and the ability slots press `ui:` sources.
- **WebXR** (slices 4–5): the `xr` context and device.
- **Hold-to-build.** Only sprint and sneak have a hold/toggle setting.
- **Remaining global key listeners.** Ctrl+S quick save, the save, a11y and
  analytics menus' Escape handlers, `utils/interaction-utils.ts` tactile
  feedback, the `systems/accessibility.ts` focus trap, the cloud placer and the
  debug tools.
