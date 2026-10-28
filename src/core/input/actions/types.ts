/**
 * Action layer types (#2027). Devices write raw sources, the layer maps them
 * to actions once per frame in the scheduler's `input` phase, and game code
 * reads actions only. See docs/INPUT.md.
 */

/** Every action the game reads. Add one here, give it a label, then bind it in `bindings.ts`. */
export const ACTION_IDS = [
    // Movement and camera
    'move',
    'look',
    'jump',
    'sprint',
    'sneak',
    // Abilities
    'dash',
    'dodge',
    'mine',
    'phase',
    'clap',
    'strike',
    'dance',
    'grenade',
    'interact',
    'fire',
    // World and HUD toggles
    'build.toggle',
    'photo.toggle',
    'jukebox',
    'daynight',
    'mute',
    'volume.up',
    'volume.down',
    'music.upload',
    'log',
    // Build mode
    'build.place',
    'build.select.add',
    'build.remove',
    'build.rotate',
    'build.scale',
    'build.tool.1',
    'build.tool.2',
    'build.tool.3',
    'build.tool.4',
    'build.piece',
    'build.category',
    'build.snap',
    'build.paint',
    'build.nudge',
    'build.recenter',
    'build.grab',
    'build.gizmo',
    'build.cancel',
    'undo',
    'redo',
    // Build gizmo
    'gizmo.translate',
    'gizmo.rotate',
    'gizmo.scale',
    'gizmo.done',
    // Dev overlays
    'debug.profiler',
    'debug.overlay',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export type Device = 'kbm' | 'gamepad' | 'touch' | 'xr';

/**
 * Contexts stack: menu over photo over gizmo over build over gameplay. A press
 * goes to the top-most context with a binding that matches it; a context with
 * `blocksBelow` also hides everything under it.
 */
export type InputContextId = 'gameplay' | 'build' | 'gizmo' | 'photo' | 'menu' | 'xr';

export interface Modifiers {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
}

/**
 * One source → one action. Sources are strings so bindings rebind and persist
 * without knowing the device:
 *
 * - `key:<KeyboardEvent.code>`  a key (`key:KeyW`, `key:Space`)
 * - `mouse:<button>`            a mouse button while the pointer is locked
 * - `mouse:move`                pointer-locked mouse motion (an analog source)
 * - `wheel:up` / `wheel:down`   one wheel notch
 * - `ui:<name>`                 an on-screen control (D-pad, ability slot)
 */
export interface Binding {
    readonly action: ActionId;
    readonly source: string;
    /**
     * Modifiers that must be held, matched exactly when present (meta counts as
     * ctrl). Absent: any modifiers. Within one context, a binding with `mods`
     * that matches wins over the same source's bindings without them.
     */
    readonly mods?: Modifiers;
    /** Which axis of `axis` this binding drives. Absent: a button. */
    readonly axis?: 'x' | 'y';
    /** Signed contribution to `value` / the axis. Default 1. */
    readonly scale?: number;
}

export interface ActionState {
    /** Held this frame (or tapped since the last frame). */
    pressed: boolean;
    justPressed: boolean;
    justReleased: boolean;
    /** The device auto-repeated a held key this frame (not on the first frame). */
    repeated: boolean;
    /** Button: the active binding's `scale` (signs carry direction). Analog: magnitude. */
    value: number;
    /** Axis actions (`move`, `look`, `build.nudge`); zero for buttons. */
    axis: { x: number; y: number };
}

export interface InputContext {
    readonly id: InputContextId;
    readonly bindings: readonly Binding[];
    readonly blocksBelow: boolean;
}

/** Actions that switch between hold and toggle in the settings. */
export type HoldToggleAction = 'sprint' | 'sneak';

export interface InputSettings {
    /** Look speed multiplier per device (1 = the old PointerLockControls speed). */
    lookSensitivity: Record<Device, number>;
    invertY: boolean;
    holdToggle: Record<HoldToggleAction, 'hold' | 'toggle'>;
}
