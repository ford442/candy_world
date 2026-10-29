/**
 * Keyboard and mouse device (#2027): DOM events → raw sources on the layer.
 *
 * This is one of the few places allowed to add global key listeners (see the
 * `no-restricted-syntax` rule in eslint.config.js). Keys typed into a text
 * field never reach the game, mouse buttons and wheel count only while the
 * pointer is locked, and Escape is never `preventDefault`ed: the browser uses
 * it to release pointer lock.
 */

import type { ActionLayer } from './action-layer.ts';

const MOD_CTRL = 1;
const MOD_SHIFT = 2;
const MOD_ALT = 4;

/** Pointer-locked mouse motion in pixels → look radians (PointerLockControls' 0.002). */
export const LOOK_RAD_PER_PIXEL = 0.002;

function isTextEntry(target: EventTarget | null): boolean {
    if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

const maskOf = (e: KeyboardEvent | MouseEvent) =>
    (e.ctrlKey || e.metaKey ? MOD_CTRL : 0) |
    (e.shiftKey ? MOD_SHIFT : 0) |
    (e.altKey ? MOD_ALT : 0);

/** Attach the device; returns the detach function. */
export function attachKeyboardMouse(layer: ActionLayer, doc: Document = document): () => void {
    const win = doc.defaultView ?? window;
    const locked = () => doc.pointerLockElement !== null;
    const gameFocused = () => {
        const el = doc.activeElement;
        return locked() || !el || el === doc.body || el.tagName === 'CANVAS';
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (!e.code || isTextEntry(e.target)) return;
        const capturing = layer.isCapturing();
        const claimed = layer.press(`key:${e.code}`, maskOf(e), 'kbm', e.repeat);
        if (capturing && claimed) {
            // A rebind took the key: the menu's own Escape/Enter must not see it.
            e.preventDefault();
            e.stopPropagation();
        } else if (claimed && gameFocused() && e.code !== 'Escape' && e.code !== 'Tab') {
            // Space on a focused button still clicks it; on the game it must not scroll.
            e.preventDefault();
        }
    };
    const onKeyUp = (e: KeyboardEvent) => {
        if (e.code) layer.release(`key:${e.code}`);
    };
    const onMouseDown = (e: MouseEvent) => {
        if (!locked()) {
            // In a menu, a left click is a click; other buttons can be captured for a rebind.
            if (!layer.isCapturing() || e.button === 0) return;
            if (layer.press(`mouse:${e.button}`, maskOf(e), 'kbm')) {
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }
        if (layer.press(`mouse:${e.button}`, maskOf(e), 'kbm')) e.preventDefault();
    };
    const onMouseUp = (e: MouseEvent) => layer.release(`mouse:${e.button}`);
    const onMouseMove = (e: MouseEvent) => {
        if (!locked()) return;
        if (e.movementX === 0 && e.movementY === 0) return;
        // Look axis: +x turns right, +y looks up.
        layer.addAnalog(
            'mouse:move',
            e.movementX * LOOK_RAD_PER_PIXEL,
            -e.movementY * LOOK_RAD_PER_PIXEL,
            'kbm'
        );
    };
    const onWheel = (e: WheelEvent) => {
        if (!locked() || e.deltaY === 0) return;
        const source = e.deltaY < 0 ? 'wheel:up' : 'wheel:down';
        if (layer.press(source, maskOf(e), 'kbm')) e.preventDefault();
        layer.release(source);
    };
    const onBlur = () => layer.releaseAll();
    const onVisibility = () => {
        if (doc.hidden) layer.releaseAll();
    };

    // Capture phase: a rebind capture must see the key before menus do.
    doc.addEventListener('keydown', onKeyDown, { capture: true });
    doc.addEventListener('keyup', onKeyUp);
    doc.addEventListener('mousedown', onMouseDown, { capture: true });
    doc.addEventListener('mouseup', onMouseUp);
    doc.addEventListener('mousemove', onMouseMove);
    win.addEventListener('wheel', onWheel, { passive: false });
    win.addEventListener('blur', onBlur);
    doc.addEventListener('visibilitychange', onVisibility);

    return () => {
        doc.removeEventListener('keydown', onKeyDown, { capture: true });
        doc.removeEventListener('keyup', onKeyUp);
        doc.removeEventListener('mousedown', onMouseDown, { capture: true });
        doc.removeEventListener('mouseup', onMouseUp);
        doc.removeEventListener('mousemove', onMouseMove);
        win.removeEventListener('wheel', onWheel);
        win.removeEventListener('blur', onBlur);
        doc.removeEventListener('visibilitychange', onVisibility);
    };
}
