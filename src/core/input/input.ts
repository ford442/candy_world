/**
 * Main Input Module (barrel)
 * Handles pointer lock controls, keyboard/mouse input, ability HUD, and drag & drop
 * Coordinates with playlist-manager and audio-controls modules
 */

export { keyStates } from './input-types.ts';
export type { KeyStates, InitInputResult } from './input-types.ts';
export { initInput } from './input/init-input.ts';
