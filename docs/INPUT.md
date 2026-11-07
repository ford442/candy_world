# Input

Game code reads **actions**, not keys. Devices write raw **sources** into the
action layer, and the layer maps them to actions once per frame. Which actions
a press can reach depends on a stack of **contexts**. Issue #2027 tracks the
work. This page covers slice 1: the layer, keyboard and mouse, contexts and
rebinding. Gamepad, touch and WebXR add devices to the same layer later.

The layer is `src/core/input/actions/`:

| File                | What it holds                                                             |
| ------------------- | ------------------------------------------------------------------------- |
| `types.ts`          | `ActionId` (every action), `Binding`, `ActionState`, `InputContextId`     |
| `bindings.ts`       | The default bindings per context, labels, `formatSource()` for prompts    |
| `action-layer.ts`   | `ActionLayer`: routing, sampling, listeners, settings, rebinding. No DOM  |
| `keyboard-mouse.ts` | The browser device: DOM events → sources                                  |
| `frame.ts`          | The `input-actions` system: menu context, sample, `keyStates`, mouse look |
| `settings-store.ts` | `localStorage` persistence of settings and rebinds (`candy-input-v1`)     |
| `index.ts`          | `input`, the app's instance                                               |

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
- In `menu`, nothing reaches the game. `menu` binds only L (discovery log).
  Menus handle Tab, Enter, Escape and arrows themselves through the DOM, so
  focus traps and screen readers keep working.

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
   `wheel:down` and `ui:<name>` for on-screen controls.
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

## Settings and rebinding

The Accessibility menu's Motor tab has a **Controls** section
(`ui/input-controls-section.ts`). It lists every keyboard/mouse binding by
context and offers:

- look sensitivity
- invert Y
- hold or toggle for sprint and sneak
- reset

Pressing a binding's button starts `input.captureNext()`:

- The next key (with its modifiers) or mouse button becomes the binding, and
  Escape cancels.
- A lone Shift, Ctrl or Alt binds itself when released.
- In a menu, left click stays a click, so it can't be captured.

Each change is announced through the live region, and so is a clash with
another binding in the same context.

Rebinds are stored as overrides of the default bindings, keyed by
`bindingKey()`, as strings like `Ctrl+Shift+key:KeyZ`. Settings and rebinds
persist in `localStorage`. Once #1974 lands they move to `WorldDocument`
settings.

Run `npm run test:input-actions` for contexts, modifiers, edges, look settings,
rebinding and persistence, and the `keyStates` bridge.

## Not yet

- **Gamepad** (slice 2): the Standard mapping, deadzones, beat haptics, and a
  build radial. `Device` and the `stick:` source prefix are reserved for it.
- **Touch** (slice 3): a virtual joystick, drag-look and tap-to-interact. Today
  only the D-pad and the ability slots press `ui:` sources.
- **WebXR** (slices 4–5): the `xr` context and device.
- **Hold-to-build.** Only sprint and sneak have a hold/toggle setting.
- **Remaining global key listeners.** Ctrl+S quick save, the save, a11y and
  analytics menus' Escape handlers, `utils/interaction-utils.ts` tactile
  feedback, the `systems/accessibility.ts` focus trap, the cloud placer and the
  debug tools.
