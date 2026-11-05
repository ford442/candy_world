/**
 * The app's action layer (#2027). Game code reads `input.get(...)` or listens
 * with `input.onPress(...)`; nothing outside core/input reads DOM key events.
 * See docs/INPUT.md.
 */

import { ActionLayer } from './action-layer.ts';
import { BeatHaptics } from './gamepad-haptics.ts';
import type { GamepadDevice } from './gamepad.ts';
import { loadPersistedInput, savePersistedInput } from './settings-store.ts';

export const input = new ActionLayer(loadPersistedInput(), savePersistedInput);

let _gamepad: GamepadDevice | null = null;

/** The attached gamepad device (`initInput()` sets it), for glyph style and haptics. */
export function activeGamepad(): GamepadDevice | null {
    return _gamepad;
}

export function setActiveGamepad(device: GamepadDevice | null): void {
    _gamepad = device;
}

/**
 * Rumble on the app's pads: kick beats are wired in `initInput()`, and
 * gameplay can call `gamepadHaptics.pulse('strong')` on a big moment.
 */
export const gamepadHaptics = new BeatHaptics(input, () => _gamepad?.pads() ?? []);

export { ActionLayer, CONTEXT_PRIORITY, type BindingRow } from './action-layer.ts';
export {
    ACTION_LABELS,
    bindingLabel,
    formatSource,
    isRebindableSource,
    sourceDevice,
    type PadStyle,
} from './bindings.ts';
export type {
    ActionId,
    ActionState,
    Binding,
    Device,
    GamepadSettings,
    InputContextId,
    InputSettings,
} from './types.ts';
