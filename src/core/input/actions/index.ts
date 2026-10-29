/**
 * The app's action layer (#2027). Game code reads `input.get(...)` or listens
 * with `input.onPress(...)`; nothing outside core/input reads DOM key events.
 * See docs/INPUT.md.
 */

import { ActionLayer } from './action-layer.ts';
import { loadPersistedInput, savePersistedInput } from './settings-store.ts';

export const input = new ActionLayer(loadPersistedInput(), savePersistedInput);

export { ActionLayer, CONTEXT_PRIORITY, type BindingRow } from './action-layer.ts';
export { ACTION_LABELS, bindingLabel, formatSource, isRebindableSource } from './bindings.ts';
export type {
    ActionId,
    ActionState,
    Binding,
    Device,
    InputContextId,
    InputSettings,
} from './types.ts';
