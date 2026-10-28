/**
 * The `input-actions` system (#2027): first in the scheduler's `input` phase.
 *
 * 1. The `menu` context follows the DOM (pause menu, jukebox).
 * 2. The layer samples every device into actions.
 * 3. Actions become `keyStates`, the input frame the fixed-step physics
 *    reads (and the determinism test replays).
 * 4. `look` turns the camera, in place of PointerLockControls' own mousemove.
 */

import * as THREE from 'three';
import { keyStates } from '../input-types.ts';
import { input } from './index.ts';

/** The part of PointerLockControls the look step uses. */
export interface LookTarget {
    object: THREE.Object3D;
    enabled: boolean;
    isLocked: boolean;
    minPolarAngle: number;
    maxPolarAngle: number;
    dispatchEvent(event: { type: 'change' }): void;
}

export interface InputFrameBindings {
    look: LookTarget | null;
    /** True while a DOM menu owns the keyboard (pause menu, jukebox). */
    isMenuOpen: () => boolean;
    /** Explore camera with WASD pan (hybrid) is active. */
    isExploreHybrid: () => boolean;
    /** HUD elements that light up while their action is held. */
    hud: Partial<
        Record<
            'forward' | 'backward' | 'left' | 'right' | 'dash' | 'mine' | 'phase',
            HTMLElement | null
        >
    >;
}

/** Stick-style threshold for turning the analog `move` axis into keyStates booleans. */
const MOVE_THRESHOLD = 0.25;
const HALF_PI = Math.PI / 2;
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _change = { type: 'change' as const };

let _bound: InputFrameBindings | null = null;
let _popMenu: (() => void) | null = null;
const _lit: Record<string, boolean> = {};

export function bindInputFrame(bindings: InputFrameBindings): () => void {
    _bound = bindings;
    return () => {
        if (_bound === bindings) _bound = null;
        _popMenu?.();
        _popMenu = null;
    };
}

function light(name: keyof InputFrameBindings['hud'], on: boolean): void {
    if (_lit[name] === on) return;
    _lit[name] = on;
    _bound?.hud[name]?.classList.toggle('keyboard-active', on);
}

export function updateInputActions(exploreActive: boolean): void {
    const menu = _bound?.isMenuOpen() ?? false;
    if (menu && !_popMenu) _popMenu = input.pushContext('menu');
    else if (!menu && _popMenu) {
        _popMenu();
        _popMenu = null;
    }

    input.sample();

    // Explore (dev orbit camera) pauses the player: no abilities, and movement
    // only pans the hybrid camera.
    const canMove = !exploreActive || (_bound?.isExploreHybrid() ?? false);
    const canAct = !exploreActive;
    const move = input.get('move').axis;
    keyStates.forward = canMove && move.y > MOVE_THRESHOLD;
    keyStates.backward = canMove && move.y < -MOVE_THRESHOLD;
    keyStates.left = canMove && move.x < -MOVE_THRESHOLD;
    keyStates.right = canMove && move.x > MOVE_THRESHOLD;
    keyStates.sprint = canAct && input.get('sprint').pressed;
    keyStates.sneak = canAct && input.get('sneak').pressed;
    keyStates.dash = canAct && input.get('dash').pressed;
    keyStates.dodgeRoll = canAct && input.get('dodge').pressed;
    keyStates.action = canAct && input.get('mine').pressed;
    keyStates.phase = canAct && input.get('phase').pressed;
    keyStates.clap = canAct && input.get('clap').pressed;
    keyStates.strike = canAct && input.get('strike').pressed;
    keyStates.dance = canAct && input.get('dance').pressed;
    // Physics consumes a jump by clearing it, so only edges write it: holding
    // the key does not jump again on landing.
    const jump = input.get('jump');
    if (!canAct || jump.justReleased) keyStates.jump = false;
    else if (jump.justPressed) keyStates.jump = true;

    light('forward', keyStates.forward);
    light('backward', keyStates.backward);
    light('left', keyStates.left);
    light('right', keyStates.right);
    light('dash', keyStates.dash);
    light('mine', keyStates.action);
    light('phase', keyStates.phase);

    applyLook();
}

function applyLook(): void {
    const target = _bound?.look;
    const look = input.get('look');
    if (!target || !look.pressed || !target.enabled || !target.isLocked) return;
    _euler.setFromQuaternion(target.object.quaternion);
    _euler.y -= look.axis.x;
    _euler.x += look.axis.y;
    _euler.x = Math.max(
        HALF_PI - target.maxPolarAngle,
        Math.min(HALF_PI - target.minPolarAngle, _euler.x)
    );
    target.object.quaternion.setFromEuler(_euler);
    target.dispatchEvent(_change);
}
