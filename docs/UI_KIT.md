# 🍭 Candy UI Kit

A lightweight HUD/GUI layer for Candy World: shared DOM primitives + candy theme
tokens. Custom CSS and a few hundred lines of TypeScript — **no UI framework**
(React/Vue are deliberately not in the dependency graph).

|               |                                                                 |
| ------------- | --------------------------------------------------------------- |
| Code          | `src/ui/kit/`                                                   |
| Styles        | `styles/kit-tokens.css` (tokens), `styles/kit.css` (components) |
| Tests         | `npm run test:ui-kit` (`tests/ui-kit.test.ts`)                  |
| First adopter | `src/ui/ability-hud.ts` (the in-world ability HUD)              |

```ts
import { createPanel, createMeter, attachTooltip, createShortcutHint } from '../ui/kit/index.ts';
```

---

## Why

Every HUD surface was a one-off: its own DOM building, its own hard-coded
pastels, its own ARIA (or none). The kit gives the pieces that were being
re-invented — a labelled panel, a real `progressbar`, a description that screen
readers actually read, a keycap badge — one implementation each.

The kit is **additive**. Existing menus (loading screen, accessibility menu,
save menu) keep working untouched and can adopt primitives one at a time.

---

## Tokens

All colour, shape, depth and motion values live as `--ck-*` CSS variables in
`styles/kit-tokens.css`, which `style.css` imports **first** so every later
stylesheet can reference them.

```css
.my-hud-thing {
    background: var(--ck-surface);
    border: var(--ck-border-width) solid var(--ck-border);
    border-radius: var(--ck-radius-md);
    box-shadow: var(--ck-shadow-panel);
    transition: border-color var(--ck-dur-base);
}
```

Groups: raw palette (`--ck-pink-400`, `--ck-grape`, …), surfaces, text, shape
(`--ck-radius-*`, `--ck-space-*`), depth (`--ck-shadow-*`, `--ck-gloss`), state
(`--ck-ready`, `--ck-active`, `--ck-danger`, `--ck-focus-ring`), motion
(`--ck-dur-*`, `--ck-ease-candy`) and layers (`--ck-z-*`).

**Prefer semantic tokens over raw palette entries** in component CSS — that is
what makes theming and reduced motion work for free:

- **Night theme** — `setKitTheme(true)` stamps `data-ck-theme="night"` on
  `<html>`, and only the semantic tokens flip.
  `updateTheme()` in `src/core/hud.ts` already calls it on the day/night cycle.
- **Reduced motion** — `prefers-reduced-motion` and the app's own
  `body.a11y-motion-reduced` class both zero `--ck-dur-*`, so any component
  built on the motion tokens respects the setting without extra code.

### HUD layering

Use `--ck-z-hud` (100) → `--ck-z-hud-raised` (150) → `--ck-z-tooltip` (400) →
`--ck-z-overlay` (900) instead of inventing a new `z-index`. `createPanel({ layer })`
selects the first three.

---

## Primitives

### `createPanel(options): Panel`

A glossy candy surface that is a properly labelled ARIA region.

```ts
const panel = createPanel({
    id: 'ability-hud',
    label: 'Abilities', // ♿ required: the region's accessible name
    anchor: 'bottom-right', // bottom-right | bottom-left | top-right | top-left | none
    layer: 'hud', // hud | raised | overlay
    bare: true, // no chrome — children carry their own surfaces
    inert: false, // see "Pointer lock" below
    children: [meter.root, slot.root],
});
document.body.appendChild(panel.root);
```

`Panel` exposes `add()`, `show()`, `hide()`, `setVisible()`, `isVisible()`,
`trapFocus()`, `releaseFocus()` and `destroy()`. `hide()` sets both `hidden` and
`aria-hidden`, so a hidden panel leaves the accessibility tree too.

**Focus trap.** `panel.trapFocus()` wraps the existing, audited
`trapFocusInside()` from `src/utils/interaction-utils.ts` (covered by
`tests/focus-trap.test.ts`) — the kit does _not_ fork it. Calling it twice
returns the same release function; `hide()` and `destroy()` release
automatically. Use it for `role="dialog"` panels, never for passive HUD.

### `createMeter(options): Meter`

A horizontal resource bar that is a real `role="progressbar"`.

```ts
const energy = createMeter({
    label: 'Energy Bar',
    max: 10,
    lowThreshold: 0.3,
    formatValueText: (v, m) => `${Math.round(v)} out of ${Math.round(m)} Energy`,
});

const crossedIntoLow = energy.setValue(player.energy, player.maxEnergy);
energy.setPulse(1 + kick * 0.25); // beat feedback; 1 clears the transform
```

`setValue()` keeps `aria-valuenow`, `aria-valuemax` and `aria-valuetext` in sync
with the fill width and **returns `true` only when the low state changed** —
which is what lets callers announce "critical energy" exactly once instead of
every frame. Styling for the critical state hangs off `[data-ck-state="low"]`,
so JS never writes colours.

### `attachTooltip(control, options): Tooltip`

```ts
const tip = attachTooltip(slot, { text: 'Dash (E)' });
tip.setText('Dash (E) - Ready!');
```

Two halves, on purpose:

1. a visually hidden description linked with **`aria-describedby`**, always in
   the accessibility tree — unlike `title`, whose announcement is inconsistent
   across screen readers. `attachTooltip` removes `title` so there is no
   duplicate native bubble;
2. a floating candy bubble on hover / `:focus-visible`, shared across controls
   and `pointer-events: none`.

The bubble is suppressed while `document.pointerLockElement` is set — there is
no cursor in first-person, so it would be pure noise. The description stays
available to assistive tech either way.

### `createShortcutHint(options): ShortcutHint`

```ts
const hint = createShortcutHint({ key: 'E', corner: true });
hint.highlight(true); // flash on key-down
setShortcut(slot, 'E'); // ♿ aria-keyshortcuts on the control itself
```

The `<kbd>` badge is `aria-hidden`: the shortcut reaches screen readers via
`aria-keyshortcuts` on the control, which is the attribute they announce.

---

## Pointer lock

The game runs pointer-locked. Two rules keep the HUD from fighting the lock:

1. **Passive panels don't take clicks.** `createPanel()` defaults to
   `inert: true` (`pointer-events: none`), so a click on a read-only readout
   falls through to the canvas and re-acquires the lock. Pass `inert: false`
   only when the panel actually contains controls.
2. **Interactive panels must be excluded from the lock click, and swallow their
   own events.** A panel with controls needs its selector listed in
   `isInteractiveTarget()` (`src/core/input/input/menu-helpers.ts`) — that
   function is what the body click handler consults before calling
   `controls.lock()` — and its controls should `stopPropagation()` on
   `pointerdown`, as `setupAbilityKeyboardInteractions()` in
   `src/core/input/input/hud-setup.ts` does.

Miss either one and clicking the HUD either re-locks the pointer under the
user's cursor or does nothing at all.

---

## Migrated surface: the ability HUD

`src/ui/ability-hud.ts` is the proof. It replaced ~20 lines of hand-written
markup in `index.html` plus direct DOM pokes scattered through
`src/core/hud.ts`.

- `index.html` now carries only `<div id="ability-hud-mount"></div>`;
  `mountAbilityHud()` (called from `runInputPipeline`, **before** `initInput()`
  so the input session can bind the slots) builds the panel, the energy meter
  and three `AbilitySlot`s.
- The DOM contract is unchanged — `#ability-hud`, `#energy-bar-container`,
  `#energy-bar-fill`, `#ability-dash|mine|phase`, `.ability-slot`,
  `.cooldown-overlay`, `.ability-count`, every `role`/`aria-label`/
  `aria-keyshortcuts`/`aria-disabled`/`aria-pressed` — so existing CSS, the
  input wiring and `tests/ability-hud-accessibility.test.ts` keep working.
- `src/core/hud.ts` now talks to the slot API
  (`setCooldown`, `setReady`, `setActive`, `describe`, `setBadge`, `pulse`)
  instead of writing `style.height`, `style.transform`, `title` and gradients
  by hand. Cooldown feedback lives in one place for all three abilities.
- `styles/ability-hud.css` lost its duplicated panel/meter rules to
  `.ck-panel`/`.ck-meter` and now expresses the slot look in `--ck-*` tokens.

> Because `src/core/hud.ts` is imported before the HUD is mounted, it resolves
> the HUD **lazily** (`abilityHud()`), not at module load. Any future kit-backed
> surface consumed by an eagerly imported module should do the same.

---

## Adding a surface

1. Build the DOM with `el()` / the primitives; never hand-roll a panel or bar.
2. Give every region a `label`, every control an accessible name, every
   shortcut an `aria-keyshortcuts`.
3. Style with `--ck-*` tokens. New value? Add a semantic token rather than a
   hex literal in the component.
4. Decide the pointer-lock contract (see above).
5. Extend `tests/ui-kit.test.ts` if you add a primitive.

## Not yet migrated

Loading screen, accessibility menu, save/serialization menu, presence panel and
the inline `<style>` block in `index.html` still predate the kit. They are
expected to adopt primitives incrementally — there is no big-bang rewrite
planned, and no surface is blocked on one.
