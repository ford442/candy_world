/**
 * Default bindings per context (#2027). Keyboard/mouse only in this slice;
 * gamepad, touch and XR sources join the same tables later.
 *
 * The `ui:` sources are the on-screen controls (D-pad, ability slots). They
 * are not rebindable and the rebinding UI hides them.
 */

import type { ActionId, Binding, InputContextId, Modifiers } from './types.ts';

const key = (action: ActionId, code: string, extra: Partial<Binding> = {}): Binding => ({
    action,
    source: `key:${code}`,
    ...extra,
});
const ctrl: Modifiers = { ctrl: true };
const shift: Modifiers = { shift: true };
const ctrlShift: Modifiers = { ctrl: true, shift: true };

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
];

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
    // Their contexts exist to stop presses reaching the game underneath.
    photo: { bindings: [], blocksBelow: true },
    // L toggles the discovery log from anywhere, as before: it opens as a menu.
    menu: { bindings: [key('log', 'KeyL')], blocksBelow: true },
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
    undo: 'Undo',
    redo: 'Redo',
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

/** `Ctrl+Shift+Z`, `Left click`, `Wheel up`: what a button prompt shows. */
export function formatSource(source: string, mods?: Modifiers): string {
    const [kind, rest] = splitSource(source);
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

/** Keyboard and mouse sources the player may rebind (not analog or on-screen ones). */
export function isRebindableSource(source: string): boolean {
    const [kind, rest] = splitSource(source);
    return kind === 'key' || (kind === 'mouse' && rest !== 'move');
}
