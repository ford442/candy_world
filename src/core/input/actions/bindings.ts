/**
 * Default bindings per context (#2027): keyboard/mouse and gamepad. Touch and
 * XR sources join the same tables later.
 *
 * The `ui:` sources are the on-screen controls (D-pad, ability slots). They
 * are not rebindable and the rebinding UI hides them, as it hides the analog
 * `mouse:move` and `stick:` sources.
 */

import type { ActionId, Binding, Device, InputContextId, Modifiers } from './types.ts';

const key = (action: ActionId, code: string, extra: Partial<Binding> = {}): Binding => ({
    action,
    source: `key:${code}`,
    ...extra,
});
const ctrl: Modifiers = { ctrl: true };
const shift: Modifiers = { shift: true };
const ctrlShift: Modifiers = { ctrl: true, shift: true };

/**
 * A gamepad button. Holding View (`pad:back`) is the pad's `ctrl`, so
 * `pad('undo', 'lb', { mods: view })` is View+LB. Plain buttons that share a
 * button with a View chord carry `mods: {}` so the chord does not fire both.
 */
const pad = (action: ActionId, button: string, extra: Partial<Binding> = {}): Binding => ({
    action,
    source: `pad:${button}`,
    ...extra,
});
const view: Modifiers = ctrl;
const plain: Modifiers = {};

/**
 * Gameplay on a pad: sticks walk and look, face buttons are jump / dash /
 * interact / build, shoulders and the d-pad are the abilities, Start pauses.
 * Holding View gives the HUD toggles.
 */
const GAMEPLAY_PAD: Binding[] = [
    { action: 'move', source: 'stick:left' },
    { action: 'look', source: 'stick:right' },
    pad('jump', 'a', { mods: plain }),
    pad('dash', 'b', { mods: plain }),
    pad('interact', 'x', { mods: plain }),
    pad('build.toggle', 'y', { mods: plain }),
    pad('fire', 'rt'),
    pad('grenade', 'lt'),
    pad('dodge', 'lb'),
    pad('strike', 'rb'),
    pad('sprint', 'ls'),
    pad('sneak', 'rs'),
    pad('phase', 'up', { mods: plain }),
    pad('mine', 'down', { mods: plain }),
    pad('clap', 'left', { mods: plain }),
    pad('dance', 'right', { mods: plain }),
    pad('pause', 'start'),
    pad('photo.toggle', 'y', { mods: view }),
    pad('log', 'a', { mods: view }),
    pad('jukebox', 'x', { mods: view }),
    pad('mute', 'b', { mods: view }),
    pad('daynight', 'up', { mods: view }),
    pad('volume.down', 'left', { mods: view }),
    pad('volume.up', 'right', { mods: view }),
];

/**
 * Build mode on a pad. Like the keyboard table it claims only what it binds:
 * the sticks, A (jump), Y (leave build mode) and Start fall through to gameplay.
 * RT places where `fire` would shoot, so `fire` does nothing here.
 */
const BUILD_PAD: Binding[] = [
    pad('build.place', 'rt', { mods: plain }),
    pad('build.select.add', 'rt', { mods: view }),
    pad('build.remove', 'lt', { mods: plain }),
    pad('build.paint', 'lt', { mods: view }),
    pad('build.rotate', 'lb', { mods: plain, scale: -1 }),
    pad('build.rotate', 'rb', { mods: plain }),
    pad('undo', 'lb', { mods: view }),
    pad('redo', 'rb', { mods: view }),
    pad('build.piece', 'left', { mods: plain, scale: -1 }),
    pad('build.piece', 'right', { mods: plain }),
    pad('build.scale', 'up', { mods: plain }),
    pad('build.scale', 'down', { mods: plain, scale: -1 }),
    pad('build.category', 'left', { mods: view, scale: -1 }),
    pad('build.category', 'right', { mods: view }),
    pad('build.snap', 'up', { mods: view }),
    pad('build.recenter', 'down', { mods: view }),
    pad('build.grab', 'x', { mods: plain }),
    pad('build.gizmo', 'rs'),
    pad('build.cancel', 'b', { mods: plain }),
    pad('build.tool.1', 'a', { mods: view }),
    pad('build.tool.2', 'x', { mods: view }),
    pad('build.tool.3', 'y', { mods: view }),
    pad('build.tool.4', 'b', { mods: view }),
];

const GIZMO_PAD: Binding[] = [
    pad('gizmo.translate', 'x'),
    pad('gizmo.rotate', 'y'),
    pad('gizmo.scale', 'rb', { mods: plain }),
    pad('gizmo.done', 'a'),
    pad('gizmo.done', 'b'),
    pad('undo', 'lb', { mods: view }),
    pad('redo', 'rb', { mods: view }),
];

/**
 * Menus keep their DOM focus handling for the keyboard. A pad has no Tab,
 * Enter or Escape, so in `menu` it moves focus, clicks and backs out through
 * these actions (`core/input/input/gamepad-menu.ts`), and Start resumes.
 */
const MENU_PAD: Binding[] = [
    pad('menu.confirm', 'a'),
    pad('menu.back', 'b'),
    pad('menu.next', 'down'),
    pad('menu.next', 'right'),
    pad('menu.prev', 'up'),
    pad('menu.prev', 'left'),
    pad('pause', 'start'),
];

/** Photo mode's panel is DOM too: the pad walks it like a menu, and B or View+Y leaves. */
const PHOTO_PAD: Binding[] = [
    ...MENU_PAD.filter((b) => b.action !== 'menu.back' && b.action !== 'pause'),
    pad('photo.toggle', 'b'),
    pad('photo.toggle', 'y', { mods: view }),
];

const GAMEPLAY: Binding[] = [
    key('move', 'KeyW', { axis: 'y', scale: 1 }),
    key('move', 'KeyS', { axis: 'y', scale: -1 }),
    key('move', 'KeyA', { axis: 'x', scale: -1 }),
    key('move', 'KeyD', { axis: 'x', scale: 1 }),
    { action: 'move', source: 'mouse:2', axis: 'y', scale: 1 },
    { action: 'move', source: 'ui:dpad-forward', axis: 'y', scale: 1 },
    { action: 'move', source: 'ui:dpad-backward', axis: 'y', scale: -1 },
    { action: 'move', source: 'ui:dpad-left', axis: 'x', scale: -1 },
    { action: 'move', source: 'ui:dpad-right', axis: 'x', scale: 1 },
    { action: 'look', source: 'mouse:move' },
    key('jump', 'Space'),
    key('sprint', 'ShiftLeft'),
    key('sprint', 'ShiftRight'),
    key('sneak', 'ControlLeft'),
    key('sneak', 'ControlRight'),
    key('dash', 'KeyE'),
    { action: 'dash', source: 'ui:dash' },
    key('dodge', 'KeyX'),
    key('mine', 'KeyF'),
    { action: 'mine', source: 'ui:mine' },
    key('phase', 'KeyZ'),
    { action: 'phase', source: 'ui:phase' },
    key('clap', 'KeyC'),
    key('strike', 'KeyV'),
    key('dance', 'KeyR'),
    key('grenade', 'KeyG'),
    { action: 'fire', source: 'mouse:0' },
    key('build.toggle', 'KeyB'),
    { action: 'build.toggle', source: 'ui:build' },
    key('photo.toggle', 'KeyP', { mods: {} }),
    key('jukebox', 'KeyQ'),
    key('daynight', 'KeyN'),
    key('mute', 'KeyM'),
    key('volume.up', 'Equal'),
    key('volume.up', 'NumpadAdd'),
    key('volume.down', 'Minus'),
    key('volume.down', 'NumpadSubtract'),
    key('music.upload', 'KeyU'),
    key('log', 'KeyL'),
    // P toggles photo mode and the frame profiler together, as it did before the action layer.
    key('debug.profiler', 'KeyP', { mods: {} }),
    key('debug.overlay', 'KeyO', { mods: {} }),
    ...heroDemoBindings(),
    ...GAMEPLAY_PAD,
];

/**
 * J / K drive the hero clip demo (`src/debug/hero-animation-demo.ts`) and
 * exist only when the page boots with `?heroAnim=1`, so the demo never takes
 * two keys from every player (or from rebinding, which treats J as free).
 */
function heroDemoBindings(): Binding[] {
    try {
        if (typeof location === 'undefined') return [];
        if (new URLSearchParams(location.search).get('heroAnim') !== '1') return [];
    } catch {
        return [];
    }
    return [key('debug.hero.next', 'KeyJ', { mods: {} }), key('debug.hero.toggle', 'KeyK', { mods: {} })];
}

// Build mode keeps walking (WASD, look, jump) from gameplay: it only claims
// the sources it binds. Mouse 0 placing here is why `fire` does nothing in it.
const BUILD: Binding[] = [
    { action: 'build.place', source: 'mouse:0', mods: {} },
    { action: 'build.select.add', source: 'mouse:0', mods: shift },
    key('build.place', 'Enter', { mods: {} }),
    key('build.place', 'NumpadEnter', { mods: {} }),
    key('build.select.add', 'Enter', { mods: shift }),
    key('build.select.add', 'NumpadEnter', { mods: shift }),
    { action: 'build.remove', source: 'mouse:2' },
    key('build.remove', 'Delete'),
    key('build.remove', 'Backspace'),
    key('build.rotate', 'KeyR', { mods: {} }),
    key('build.rotate', 'KeyR', { mods: shift, scale: -1 }),
    // A key turns 45°, a wheel notch a third of that.
    { action: 'build.rotate', source: 'wheel:up', mods: {}, scale: 1 / 3 },
    { action: 'build.rotate', source: 'wheel:down', mods: {}, scale: -1 / 3 },
    { action: 'build.scale', source: 'wheel:up', mods: shift },
    { action: 'build.scale', source: 'wheel:down', mods: shift, scale: -1 },
    key('build.scale', 'Equal'),
    key('build.scale', 'NumpadAdd'),
    key('build.scale', 'Minus', { scale: -1 }),
    key('build.scale', 'NumpadSubtract', { scale: -1 }),
    key('build.tool.1', 'Digit1', { mods: {} }),
    key('build.tool.2', 'Digit2', { mods: {} }),
    key('build.tool.3', 'Digit3', { mods: {} }),
    key('build.tool.4', 'Digit4', { mods: {} }),
    key('build.piece', 'BracketLeft', { mods: {}, scale: -1 }),
    key('build.piece', 'BracketRight', { mods: {} }),
    key('build.category', 'BracketLeft', { mods: shift, scale: -1 }),
    key('build.category', 'BracketRight', { mods: shift }),
    key('build.snap', 'KeyG', { mods: {} }),
    key('build.paint', 'KeyC', { mods: {} }),
    key('build.paint', 'KeyC', { mods: shift, scale: -1 }),
    key('build.nudge', 'ArrowLeft', { axis: 'x', scale: -1 }),
    key('build.nudge', 'ArrowRight', { axis: 'x', scale: 1 }),
    key('build.nudge', 'ArrowUp', { axis: 'y', scale: 1 }),
    key('build.nudge', 'ArrowDown', { axis: 'y', scale: -1 }),
    key('build.recenter', 'Home'),
    key('build.grab', 'KeyM', { mods: {} }),
    key('build.gizmo', 'KeyF', { mods: {} }),
    key('build.cancel', 'Escape'),
    key('undo', 'KeyZ', { mods: ctrl }),
    key('redo', 'KeyZ', { mods: ctrlShift }),
    key('redo', 'KeyY', { mods: ctrl }),
    ...BUILD_PAD,
];

// The gizmo frees the cursor for dragging handles, so it blocks walking too.
const GIZMO: Binding[] = [
    key('gizmo.translate', 'KeyT'),
    key('gizmo.rotate', 'KeyY', { mods: {} }),
    key('gizmo.scale', 'KeyU'),
    key('gizmo.done', 'Enter'),
    key('gizmo.done', 'NumpadEnter'),
    key('gizmo.done', 'Escape'),
    key('undo', 'KeyZ', { mods: ctrl }),
    key('redo', 'KeyZ', { mods: ctrlShift }),
    key('redo', 'KeyY', { mods: ctrl }),
    ...GIZMO_PAD,
];

export const DEFAULT_CONTEXTS: Record<
    InputContextId,
    { bindings: readonly Binding[]; blocksBelow: boolean }
> = {
    gameplay: { bindings: GAMEPLAY, blocksBelow: false },
    build: { bindings: BUILD, blocksBelow: false },
    gizmo: { bindings: GIZMO, blocksBelow: true },
    // Photo mode's panel and the menus handle their own keys through the DOM
    // (focus, Enter, Escape) so screen readers and focus traps keep working.
    // Their contexts exist to stop presses reaching the game underneath, and
    // to give a pad, which has no Tab or Enter, a way through them.
    photo: { bindings: PHOTO_PAD, blocksBelow: true },
    // L toggles the discovery log from anywhere, as before: it opens as a menu.
    menu: { bindings: [key('log', 'KeyL'), ...MENU_PAD], blocksBelow: true },
    xr: { bindings: [], blocksBelow: false },
};

/** Human labels for the rebinding UI and announcements. */
export const ACTION_LABELS: Partial<Record<ActionId, string>> = {
    jump: 'Jump',
    sprint: 'Sprint',
    sneak: 'Sneak',
    dash: 'Dash',
    dodge: 'Dodge roll',
    mine: 'Jitter mine',
    phase: 'Phase shift',
    clap: 'Clap',
    strike: 'Chord strike',
    dance: 'Dance',
    grenade: 'Glitch grenade',
    interact: 'Interact',
    fire: 'Fire / interact',
    'build.toggle': 'Build mode',
    'photo.toggle': 'Photo mode',
    jukebox: 'Jukebox',
    daynight: 'Day / night',
    mute: 'Mute',
    'volume.up': 'Volume up',
    'volume.down': 'Volume down',
    'music.upload': 'Upload music',
    log: 'Discovery log',
    'build.place': 'Build: place / use tool',
    'build.remove': 'Build: remove',
    'build.rotate': 'Build: rotate',
    'build.grab': 'Build: move piece',
    'build.gizmo': 'Build: gizmo',
    'build.snap': 'Build: grid snap',
    'build.select.add': 'Build: add to selection',
    'build.scale': 'Build: scale',
    'build.piece': 'Build: next piece',
    'build.category': 'Build: next category',
    'build.paint': 'Build: next paint',
    'build.recenter': 'Build: recenter cursor',
    'build.cancel': 'Build: cancel',
    'build.tool.1': 'Build: place tool',
    'build.tool.2': 'Build: select tool',
    'build.tool.3': 'Build: paint tool',
    'build.tool.4': 'Build: remove tool',
    undo: 'Undo',
    redo: 'Redo',
    'gizmo.translate': 'Gizmo: move',
    'gizmo.rotate': 'Gizmo: rotate',
    'gizmo.scale': 'Gizmo: scale',
    'gizmo.done': 'Gizmo: done',
    pause: 'Pause / resume',
    'menu.confirm': 'Menu: select',
    'menu.back': 'Menu: back',
    'menu.next': 'Menu: next',
    'menu.prev': 'Menu: previous',
};

const MOVE_LABELS: Record<string, string> = {
    'y:1': 'Move forward',
    'y:-1': 'Move back',
    'x:-1': 'Move left',
    'x:1': 'Move right',
};

/** Label for one binding row: movement rows name their direction. */
export function bindingLabel(b: Binding): string {
    if (b.action === 'move' && b.axis) {
        return MOVE_LABELS[`${b.axis}:${b.scale ?? 1}`] ?? 'Move';
    }
    const base = ACTION_LABELS[b.action] ?? b.action;
    return (b.scale ?? 1) < 0 ? `${base} (reverse)` : base;
}

const KEY_NAMES: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    Equal: '=',
    Minus: '-',
    NumpadAdd: 'Num +',
    NumpadSubtract: 'Num -',
    BracketLeft: '[',
    BracketRight: ']',
    Backquote: '`',
    Enter: 'Enter',
    NumpadEnter: 'Num Enter',
};

const MOUSE_NAMES = ['Left click', 'Middle click', 'Right click', 'Mouse 4', 'Mouse 5'];

/** Button glyph families: the pad's vendor picks which names a prompt shows. */
export type PadStyle = 'xbox' | 'playstation';

/** Standard Gamepad mapping, button index → source name (`pad:<name>`). */
export const PAD_BUTTONS = [
    'a',
    'b',
    'x',
    'y',
    'lb',
    'rb',
    'lt',
    'rt',
    'back',
    'start',
    'ls',
    'rs',
    'up',
    'down',
    'left',
    'right',
    'home',
] as const;

const PAD_NAMES: Record<PadStyle, Record<string, string>> = {
    xbox: {
        a: 'A',
        b: 'B',
        x: 'X',
        y: 'Y',
        lb: 'LB',
        rb: 'RB',
        lt: 'LT',
        rt: 'RT',
        back: 'View',
        start: 'Menu',
        ls: 'Left stick click',
        rs: 'Right stick click',
        home: 'Guide',
    },
    playstation: {
        a: 'Cross',
        b: 'Circle',
        x: 'Square',
        y: 'Triangle',
        lb: 'L1',
        rb: 'R1',
        lt: 'L2',
        rt: 'R2',
        back: 'Create',
        start: 'Options',
        ls: 'L3',
        rs: 'R3',
        home: 'PS',
    },
};

/** `Ctrl+Shift+Z`, `Left click`, `Wheel up`, `View+LB`: what a button prompt shows. */
export function formatSource(source: string, mods?: Modifiers, style: PadStyle = 'xbox'): string {
    const [kind, rest] = splitSource(source);
    if (kind === 'pad' || kind === 'stick') {
        const names = PAD_NAMES[style];
        const name =
            kind === 'stick'
                ? `${rest === 'left' ? 'Left' : 'Right'} stick`
                : (names[rest] ?? `D-pad ${rest}`);
        return mods?.ctrl ? `${names.back}+${name}` : name;
    }
    let name: string;
    if (kind === 'key') {
        name = KEY_NAMES[rest] ?? rest.replace(/^(Key|Digit|Arrow)/, '');
        if (rest.startsWith('Arrow')) name = `${name} arrow`;
    } else if (kind === 'mouse') {
        name = rest === 'move' ? 'Mouse' : (MOUSE_NAMES[Number(rest)] ?? `Mouse ${rest}`);
    } else if (kind === 'wheel') {
        name = rest === 'up' ? 'Wheel up' : 'Wheel down';
    } else {
        name = rest;
    }
    const prefix = `${mods?.ctrl ? 'Ctrl+' : ''}${mods?.alt ? 'Alt+' : ''}${mods?.shift ? 'Shift+' : ''}`;
    return prefix + name;
}

export function splitSource(source: string): [string, string] {
    const i = source.indexOf(':');
    return i < 0 ? [source, ''] : [source.slice(0, i), source.slice(i + 1)];
}

/** Keyboard, mouse and gamepad buttons the player may rebind (not analog or on-screen ones). */
export function isRebindableSource(source: string): boolean {
    const [kind, rest] = splitSource(source);
    return kind === 'key' || kind === 'pad' || (kind === 'mouse' && rest !== 'move');
}

/** Which device produces `source`; null for on-screen `ui:` controls. */
export function sourceDevice(source: string): Device | null {
    const kind = splitSource(source)[0];
    if (kind === 'pad' || kind === 'stick') return 'gamepad';
    if (kind === 'key' || kind === 'mouse' || kind === 'wheel') return 'kbm';
    return null;
}
